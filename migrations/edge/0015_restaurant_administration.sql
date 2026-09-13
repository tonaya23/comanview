BEGIN;

-- No operational defaults are invented by the schema migration. Production
-- initialization must verify the installation and persist an explicit baseline.
CREATE TABLE business_profiles (
  location_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  commercial_name TEXT,
  legal_name TEXT,
  phone TEXT,
  email TEXT,
  address_json TEXT NOT NULL DEFAULT '{}',
  operating_hours_json TEXT NOT NULL DEFAULT '[]',
  logo_bytes BLOB CHECK (logo_bytes IS NULL OR length(logo_bytes) <= 1048576),
  logo_mime TEXT CHECK (logo_mime IS NULL OR logo_mime IN ('image/png','image/jpeg')),
  logo_width INTEGER CHECK (logo_width IS NULL OR logo_width BETWEEN 1 AND 2048),
  logo_height INTEGER CHECK (logo_height IS NULL OR logo_height BETWEEN 1 AND 2048),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE operational_configuration (
  location_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  operational_timezone TEXT,
  business_day_rollover TEXT,
  business_day_version INTEGER NOT NULL DEFAULT 0 CHECK (business_day_version >= 0),
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  currency_locked INTEGER NOT NULL DEFAULT 0 CHECK (currency_locked IN (0,1)),
  default_cash_register_id TEXT REFERENCES cash_registers(id),
  default_tax_profile_id TEXT REFERENCES tax_profiles(id),
  fiscal_policy_version INTEGER NOT NULL DEFAULT 0 CHECK (fiscal_policy_version IN (0,1)),
  tip_preferences_json TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER trg_currency_lock_monotonic BEFORE UPDATE OF currency_locked,currency ON operational_configuration
WHEN OLD.currency_locked = 1 AND (NEW.currency_locked != 1 OR NEW.currency IS NOT OLD.currency)
BEGIN SELECT RAISE(ABORT,'CURRENCY_LOCKED'); END;
CREATE TRIGGER trg_currency_lock_order AFTER INSERT ON orders BEGIN
 UPDATE operational_configuration SET currency_locked=1 WHERE location_id=NEW.location_id;
END;
CREATE TRIGGER trg_currency_lock_cash AFTER INSERT ON cash_sessions BEGIN
 UPDATE operational_configuration SET currency_locked=1 WHERE location_id=NEW.location_id;
END;
CREATE TRIGGER trg_currency_lock_payment AFTER INSERT ON payments BEGIN
 UPDATE operational_configuration SET currency_locked=1 WHERE location_id=(SELECT location_id FROM orders WHERE id=NEW.order_id);
END;
CREATE TRIGGER trg_currency_lock_movement AFTER INSERT ON cash_movements BEGIN
 UPDATE operational_configuration SET currency_locked=1 WHERE location_id=(SELECT location_id FROM cash_sessions WHERE id=NEW.cash_session_id);
END;

ALTER TABLE tax_profiles ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE tax_profile_revisions (
  tax_profile_id TEXT NOT NULL REFERENCES tax_profiles(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points >= 0),
  calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('TAX_ADDED','TAX_INCLUDED')),
  created_at INTEGER,
  PRIMARY KEY (tax_profile_id,revision)
);
-- This records the currently known profile, not its unknowable historical origin.
INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode)
SELECT id,1,rate_basis_points,calculation_mode FROM tax_profiles;
CREATE TRIGGER trg_tax_revision_immutable_update BEFORE UPDATE ON tax_profile_revisions
BEGIN SELECT RAISE(ABORT,'TAX_REVISION_IMMUTABLE'); END;
CREATE TRIGGER trg_tax_revision_immutable_delete BEFORE DELETE ON tax_profile_revisions
BEGIN SELECT RAISE(ABORT,'TAX_REVISION_IMMUTABLE'); END;

ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE products ADD COLUMN tax_profile_revision INTEGER;
UPDATE products SET tax_profile_revision = 1;
ALTER TABLE orders ADD COLUMN tax_policy_version INTEGER NOT NULL DEFAULT 0 CHECK (tax_policy_version IN (0,1));
ALTER TABLE order_items ADD COLUMN tax_policy_version INTEGER NOT NULL DEFAULT 0 CHECK (tax_policy_version IN (0,1));
ALTER TABLE order_items ADD COLUMN tax_profile_id TEXT;
ALTER TABLE order_items ADD COLUMN tax_profile_revision INTEGER;

ALTER TABLE cash_registers ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE cash_registers ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_sessions ADD COLUMN business_day_policy_json TEXT;

ALTER TABLE stations ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE stations ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stations ADD COLUMN purpose TEXT;
ALTER TABLE stations ADD COLUMN kds_visible INTEGER NOT NULL DEFAULT 1 CHECK (kds_visible IN (0,1));
CREATE TABLE zones (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE UNIQUE INDEX unq_zone_name_location ON zones(location_id,name);
ALTER TABLE restaurant_tables ADD COLUMN zone_id TEXT REFERENCES zones(id);
ALTER TABLE restaurant_tables ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
-- Legacy zone TEXT is retained until the production baseline maps exact names to UUIDs.

ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE users ADD COLUMN trust_domain_id TEXT;
ALTER TABLE users ADD COLUMN credential_revision INTEGER CHECK (credential_revision > 0);
ALTER TABLE users ADD COLUMN authorization_revision INTEGER CHECK (authorization_revision > 0);
ALTER TABLE auth_sessions ADD COLUMN trust_domain_id TEXT;
ALTER TABLE auth_sessions ADD COLUMN credential_revision INTEGER;
ALTER TABLE auth_sessions ADD COLUMN authorization_revision INTEGER;
ALTER TABLE auth_sessions ADD COLUMN session_revision INTEGER;
ALTER TABLE auth_sessions ADD COLUMN issued_recovery_epoch INTEGER;
-- NULL is deliberate: adding columns does not bless restored legacy credentials.

CREATE TABLE personnel_security_intents (
  transition_id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  trust_domain_id TEXT NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 0),
  transition_digest TEXT NOT NULL CHECK (length(transition_digest) = 64),
  descriptor_json TEXT NOT NULL,
  private_payload_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('PREPARED','APPLIED','SUPERSEDED')),
  created_at INTEGER NOT NULL
);
CREATE TABLE personnel_baseline_receipts (
  trust_domain_id TEXT PRIMARY KEY NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 0),
  users_digest TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE TABLE personnel_security_receipts (
  transition_id TEXT PRIMARY KEY NOT NULL REFERENCES personnel_security_intents(transition_id),
  transition_digest TEXT NOT NULL CHECK (length(transition_digest) = 64),
  user_id TEXT NOT NULL,
  trust_domain_id TEXT NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 0),
  credential_revision INTEGER NOT NULL CHECK (credential_revision > 0),
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision > 0),
  session_revision INTEGER NOT NULL CHECK (session_revision > 0),
  audit_id TEXT NOT NULL REFERENCES audit_log(audit_id),
  completed_at INTEGER NOT NULL
);
CREATE TABLE owner_recovery_acknowledgements (
  authorization_id TEXT PRIMARY KEY NOT NULL,
  transition_id TEXT NOT NULL REFERENCES personnel_security_intents(transition_id),
  command_id TEXT NOT NULL UNIQUE,
  consumed_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);
CREATE TABLE administration_command_receipts (
  command_id TEXT PRIMARY KEY NOT NULL,
  location_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch >= 0),
  completed_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO permissions(code,description) VALUES
 ('ADMINISTRATION_VIEW','View local administration'),
 ('BUSINESS_PROFILE_MANAGE','Manage business profile'),
 ('BUSINESS_DAY_POLICY_MANAGE','Manage business day policy'),
 ('CURRENCY_MANAGE','Configure operational currency'),
 ('TAX_PROFILE_MANAGE','Manage fiscal configuration'),
 ('PERSONNEL_VIEW','View personnel administration'),
 ('PERSONNEL_MANAGE','Manage operational personnel'),
 ('PERSONNEL_PRIVILEGED_MANAGE','Manage privileged personnel'),
 ('PERSONNEL_RECOVERY','Repair personnel security'),
 ('OWN_PIN_CHANGE','Change own operational PIN'),
 ('CASH_REGISTER_MANAGE','Manage cash registers'),
 ('STATION_MANAGE','Manage logical stations'),
 ('TABLE_MANAGE','Manage tables and zones'),
 ('TIP_PREFERENCES_MANAGE','Manage local tip preferences');
INSERT OR IGNORE INTO role_permissions(role_id,permission_code)
 SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.name='OWNER' AND p.code IN
 ('ADMINISTRATION_VIEW','BUSINESS_PROFILE_MANAGE','BUSINESS_DAY_POLICY_MANAGE','CURRENCY_MANAGE',
 'TAX_PROFILE_MANAGE','PERSONNEL_VIEW','PERSONNEL_MANAGE','PERSONNEL_PRIVILEGED_MANAGE',
 'PERSONNEL_RECOVERY','OWN_PIN_CHANGE','CASH_REGISTER_MANAGE','STATION_MANAGE','TABLE_MANAGE','TIP_PREFERENCES_MANAGE');
INSERT OR IGNORE INTO role_permissions(role_id,permission_code)
 SELECT r.id,p.code FROM roles r CROSS JOIN permissions p WHERE r.name='MANAGER' AND p.code IN
 ('ADMINISTRATION_VIEW','BUSINESS_PROFILE_MANAGE','PERSONNEL_VIEW','PERSONNEL_MANAGE',
 'OWN_PIN_CHANGE','CASH_REGISTER_MANAGE','STATION_MANAGE','TABLE_MANAGE');
INSERT OR IGNORE INTO role_permissions(role_id,permission_code)
 SELECT id,'OWN_PIN_CHANGE' FROM roles WHERE name IN ('CASHIER','WAITER','KITCHEN');

PRAGMA user_version = 15;
COMMIT;
