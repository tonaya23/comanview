BEGIN;

CREATE TABLE cloud_plan_device_limits (
  plan_id UUID NOT NULL REFERENCES cloud_plans(plan_id),
  device_type TEXT NOT NULL CHECK(device_type IN ('POS','WAITER','KDS')),
  max_active_devices INTEGER CHECK(max_active_devices IS NULL OR max_active_devices >= 0),
  PRIMARY KEY(plan_id,device_type)
);

CREATE TABLE cloud_installation_authorizations (
  authorization_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  pairing_id UUID NOT NULL,
  pairing_code_hash TEXT NOT NULL,
  device_id UUID NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('POS','WAITER','KDS')),
  display_name TEXT NOT NULL,
  initial_owner_id UUID NOT NULL,
  initial_owner_display_name TEXT NOT NULL,
  kid TEXT NOT NULL,
  envelope JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ISSUED','CONSUMED','EXPIRED','REVOKED')),
  command_id UUID NOT NULL UNIQUE,
  issued_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_command_id UUID UNIQUE,
  CONSTRAINT fk_installation_authorization_location FOREIGN KEY(tenant_id,location_id)
    REFERENCES cloud_locations(tenant_id,location_id)
);
CREATE UNIQUE INDEX unq_active_installation_authorization
 ON cloud_installation_authorizations(edge_id) WHERE status='ISSUED';

COMMIT;
