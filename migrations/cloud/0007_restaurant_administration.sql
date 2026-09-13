BEGIN;

-- Cloud-owned association. Neither operational Sync nor backup user_roles can write it.
CREATE TABLE cloud_contractual_owners (
  location_id UUID PRIMARY KEY REFERENCES cloud_locations(location_id),
  tenant_id UUID NOT NULL REFERENCES cloud_tenants(tenant_id),
  owner_user_id UUID NOT NULL,
  installation_authorization_id UUID NOT NULL REFERENCES cloud_installation_authorizations(authorization_id),
  created_at TIMESTAMPTZ NOT NULL
);
-- Only unambiguous completed Cloud authorizations are admissible legacy evidence.
-- Ambiguous/absent evidence remains unmapped and recovery fails closed.
INSERT INTO cloud_contractual_owners(location_id,tenant_id,owner_user_id,installation_authorization_id,created_at)
SELECT DISTINCT ON (a.location_id) a.location_id,a.tenant_id,a.initial_owner_id,a.authorization_id,a.issued_at
FROM cloud_installation_authorizations a
WHERE a.status='CONSUMED' AND a.location_id IN (
 SELECT location_id FROM cloud_installation_authorizations WHERE status='CONSUMED'
 GROUP BY location_id HAVING count(DISTINCT initial_owner_id)=1)
ORDER BY a.location_id,a.issued_at,a.authorization_id;

CREATE TABLE cloud_owner_recovery_authorizations (
  authorization_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES cloud_contractual_owners(location_id),
  target_edge_id UUID NOT NULL REFERENCES edges(edge_id),
  owner_user_id UUID NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch>=0),
  trust_domain_id UUID NOT NULL,
  access_generation BIGINT NOT NULL CHECK(access_generation>=0),
  challenge_id UUID NOT NULL,
  request_digest TEXT NOT NULL,
  kid TEXT NOT NULL,
  envelope JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ISSUED','CONSUMED','EXPIRED','REVOKED')),
  command_id UUID NOT NULL UNIQUE,
  issued_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_command_id UUID UNIQUE,
  CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes'),
  UNIQUE(target_edge_id,trust_domain_id,access_generation,challenge_id)
);

-- Operational administration is projected for Cloud visibility only. Edge remains
-- authoritative; payloads are public descriptors and never credential material.
CREATE TABLE cloud_restaurant_administration_projection (
  location_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  source_edge_id UUID NOT NULL,
  public_state JSONB NOT NULL,
  last_event_id UUID NOT NULL,
  last_local_sequence BIGINT NOT NULL,
  last_recovery_epoch INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(location_id,entity_type,entity_id)
);

COMMIT;
