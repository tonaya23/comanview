BEGIN;

CREATE TABLE cloud_tenants (
  tenant_id UUID PRIMARY KEY,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cloud_tenant_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE cloud_locations (
  location_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES cloud_tenants(tenant_id),
  display_name TEXT,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  configuration_status TEXT NOT NULL DEFAULT 'COMPLETE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cloud_location_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT chk_cloud_location_configuration_status
    CHECK (configuration_status IN ('COMPLETE', 'PENDING_CONFIGURATION')),
  CONSTRAINT chk_cloud_location_complete
    CHECK (configuration_status = 'PENDING_CONFIGURATION'
      OR (display_name IS NOT NULL AND timezone IS NOT NULL)),
  UNIQUE (tenant_id, location_id)
);

-- Existing 1P identities contain no trustworthy commercial names/timezones.
-- Preserve their binding without inventing either value.
INSERT INTO cloud_tenants (tenant_id, status)
SELECT DISTINCT tenant_id, 'ACTIVE' FROM edges
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO cloud_locations
  (location_id, tenant_id, status, configuration_status)
SELECT DISTINCT location_id, tenant_id, 'ACTIVE', 'PENDING_CONFIGURATION'
FROM edges
ON CONFLICT (location_id) DO NOTHING;

ALTER TABLE edges
  ADD COLUMN provisioned_at TIMESTAMPTZ,
  ADD COLUMN activated_at TIMESTAMPTZ,
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN replaced_at TIMESTAMPTZ,
  ADD COLUMN replaced_by_edge_id UUID REFERENCES edges(edge_id),
  ADD COLUMN provisioning_attempt_id UUID;

ALTER TABLE edges DROP CONSTRAINT IF EXISTS chk_edge_lifecycle_status;
ALTER TABLE edges ADD CONSTRAINT chk_edge_lifecycle_status
  CHECK (status IN ('PROVISIONING', 'ACTIVE', 'REVOKED', 'REPLACED'));
ALTER TABLE edges ADD CONSTRAINT fk_edges_tenant
  FOREIGN KEY (tenant_id) REFERENCES cloud_tenants(tenant_id);
ALTER TABLE edges ADD CONSTRAINT fk_edges_tenant_location
  FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id);

CREATE UNIQUE INDEX unq_location_active_edge
  ON edges(location_id) WHERE status = 'ACTIVE';

CREATE TABLE edge_credentials (
  credential_id UUID PRIMARY KEY,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  credential_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  rotation_id UUID,
  issued_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  retire_after TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT chk_edge_credential_status
    CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRING', 'REVOKED'))
);

CREATE UNIQUE INDEX unq_edge_active_credential
  ON edge_credentials(edge_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX unq_edge_open_rotation
  ON edge_credentials(edge_id) WHERE status = 'PENDING' AND rotation_id IS NOT NULL;
CREATE UNIQUE INDEX unq_edge_rotation_id
  ON edge_credentials(rotation_id) WHERE rotation_id IS NOT NULL;
CREATE INDEX idx_edge_credentials_auth
  ON edge_credentials(edge_id, credential_hash, status);

INSERT INTO edge_credentials
  (credential_id, edge_id, credential_hash, status, issued_at, activated_at)
SELECT gen_random_uuid(), edge_id, credential_hash, 'ACTIVE', created_at,
       COALESCE(updated_at, created_at)
FROM edges;

ALTER TABLE edges ALTER COLUMN credential_hash DROP NOT NULL;
COMMENT ON COLUMN edges.credential_hash IS
  'Legacy 1P credential hash; edge_credentials is authoritative from migration 0003.';

CREATE TABLE edge_provisioning_codes (
  provisioning_code_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_edge_id UUID REFERENCES edges(edge_id),
  revoked_at TIMESTAMPTZ,
  revoked_by_admin_user_id UUID REFERENCES cloud_admin_users(user_id),
  CONSTRAINT fk_provisioning_code_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id),
  CONSTRAINT chk_provisioning_code_status
    CHECK (status IN ('ISSUED', 'CONSUMED', 'REVOKED')),
  CONSTRAINT chk_provisioning_code_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_provisioning_codes_location
  ON edge_provisioning_codes(tenant_id, location_id, status, expires_at);
CREATE UNIQUE INDEX unq_issued_provisioning_code_location
  ON edge_provisioning_codes(location_id) WHERE status = 'ISSUED';

CREATE TABLE edge_provisioning_attempts (
  attempt_id UUID PRIMARY KEY,
  provisioning_code_id UUID NOT NULL REFERENCES edge_provisioning_codes(provisioning_code_id),
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  credential_id UUID NOT NULL REFERENCES edge_credentials(credential_id),
  credential_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'EXCHANGED',
  exchanged_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  last_retry_at TIMESTAMPTZ,
  CONSTRAINT chk_provisioning_attempt_status
    CHECK (status IN ('EXCHANGED', 'ACTIVATED', 'ABORTED')),
  UNIQUE (provisioning_code_id),
  UNIQUE (edge_id)
);

ALTER TABLE edges ADD CONSTRAINT fk_edges_provisioning_attempt
  FOREIGN KEY (provisioning_attempt_id) REFERENCES edge_provisioning_attempts(attempt_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE edge_replacements (
  replacement_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  old_edge_id UUID NOT NULL REFERENCES edges(edge_id),
  new_edge_id UUID REFERENCES edges(edge_id),
  provisioning_code_id UUID NOT NULL REFERENCES edge_provisioning_codes(provisioning_code_id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL,
  initiated_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  initiated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT fk_edge_replacement_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id),
  CONSTRAINT chk_edge_replacement_status
    CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELLED'))
);

CREATE UNIQUE INDEX unq_open_edge_replacement
  ON edge_replacements(location_id) WHERE status = 'PENDING';

CREATE TABLE cloud_admin_audit_chain_heads (
  scope_key TEXT PRIMARY KEY,
  last_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE cloud_admin_audit_log (
  audit_id UUID PRIMARY KEY,
  scope_key TEXT NOT NULL,
  actor_admin_user_id UUID REFERENCES cloud_admin_users(user_id),
  session_id UUID REFERENCES cloud_admin_sessions(session_id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  tenant_id UUID,
  location_id UUID,
  edge_id UUID,
  command_id UUID NOT NULL UNIQUE,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES cloud_tenants(tenant_id),
  FOREIGN KEY (location_id) REFERENCES cloud_locations(location_id),
  FOREIGN KEY (edge_id) REFERENCES edges(edge_id)
);

CREATE INDEX idx_cloud_admin_audit_scope_time
  ON cloud_admin_audit_log(scope_key, occurred_at, audit_id);

ALTER TABLE cloud_admin_users DROP CONSTRAINT chk_cloud_admin_role;
ALTER TABLE cloud_admin_users ADD CONSTRAINT chk_cloud_admin_role
  CHECK (role IN ('PLATFORM_ADMIN', 'PLATFORM_ADMIN_READ', 'SUPPORT_READ'));

COMMIT;
