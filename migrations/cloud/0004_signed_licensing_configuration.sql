BEGIN;

CREATE TABLE cloud_plans (
  plan_id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE cloud_plan_entitlements (
  plan_id UUID NOT NULL REFERENCES cloud_plans(plan_id),
  capability TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (plan_id, capability)
);

CREATE TABLE cloud_location_license_state (
  location_id UUID PRIMARY KEY REFERENCES cloud_locations(location_id),
  tenant_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES cloud_plans(plan_id),
  declared_state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cloud_license_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id),
  CONSTRAINT chk_cloud_license_state
    CHECK (declared_state IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'TERMINATED'))
);

CREATE TABLE cloud_location_configuration_state (
  location_id UUID PRIMARY KEY REFERENCES cloud_locations(location_id),
  tenant_id UUID NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  configuration JSONB NOT NULL,
  updated_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cloud_configuration_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id)
);

CREATE TABLE cloud_location_feature_flag_state (
  location_id UUID PRIMARY KEY REFERENCES cloud_locations(location_id),
  tenant_id UUID NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cloud_feature_flags_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id)
);

CREATE TABLE cloud_location_control_state (
  location_id UUID PRIMARY KEY REFERENCES cloud_locations(location_id),
  tenant_id UUID NOT NULL,
  desired_control_revision BIGINT NOT NULL DEFAULT 1 CHECK (desired_control_revision > 0),
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cloud_control_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id)
);

CREATE TABLE cloud_signed_control_documents (
  document_id UUID PRIMARY KEY,
  document_type TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  kid TEXT NOT NULL,
  document_hash TEXT NOT NULL,
  envelope JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  grace_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fk_cloud_control_document_location
    FOREIGN KEY (tenant_id, location_id) REFERENCES cloud_locations(tenant_id, location_id),
  CONSTRAINT chk_cloud_control_document_type
    CHECK (document_type IN ('LICENSE', 'FEATURE_FLAGS', 'CONFIGURATION')),
  UNIQUE (edge_id, document_type, revision),
  UNIQUE (edge_id, document_type, document_hash)
);

CREATE INDEX idx_cloud_control_documents_current
  ON cloud_signed_control_documents(edge_id, document_type, revision DESC);

CREATE TABLE cloud_edge_control_state_acks (
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  document_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_hash TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  command_id UUID NOT NULL UNIQUE,
  PRIMARY KEY (edge_id, document_type, revision),
  CONSTRAINT chk_cloud_control_ack_type
    CHECK (document_type IN ('LICENSE', 'FEATURE_FLAGS', 'CONFIGURATION'))
);

COMMIT;
