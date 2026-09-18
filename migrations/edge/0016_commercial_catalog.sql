BEGIN;

-- Data normalization and the one-time UUID are performed by the canonical
-- catalog migration primitive in the same transaction as this incremental SQL.
ALTER TABLE categories ADD COLUMN system_key TEXT CHECK (system_key IS NULL OR system_key='UNCATEGORIZED');
ALTER TABLE categories ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE categories ADD COLUMN updated_at INTEGER;
ALTER TABLE categories ADD COLUMN updated_by TEXT;
CREATE UNIQUE INDEX unq_category_system_key ON categories(system_key) WHERE system_key IS NOT NULL;
CREATE TRIGGER trg_system_category_delete BEFORE DELETE ON categories WHEN OLD.system_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'CATEGORY_SYSTEM_PROTECTED'); END;
CREATE TRIGGER trg_system_category_update BEFORE UPDATE ON categories
WHEN OLD.system_key IS NOT NULL AND (NEW.system_key IS NOT OLD.system_key OR NEW.id IS NOT OLD.id OR NEW.active<>1)
BEGIN SELECT RAISE(ABORT,'CATEGORY_SYSTEM_PROTECTED'); END;

ALTER TABLE products ADD COLUMN sku_key TEXT;
ALTER TABLE products ADD COLUMN updated_at INTEGER;
ALTER TABLE products ADD COLUMN updated_by TEXT;
CREATE INDEX idx_product_sku_key ON products(sku_key);
CREATE INDEX idx_product_category_active ON products(category_id,active);
CREATE TABLE catalog_sku_claims (
  sku_key TEXT PRIMARY KEY NOT NULL,
  product_id TEXT REFERENCES products(id),
  state TEXT NOT NULL CHECK (state IN ('CLAIMED','CONFLICT')),
  CHECK ((state='CLAIMED' AND product_id IS NOT NULL) OR (state='CONFLICT' AND product_id IS NULL))
);
CREATE TABLE catalog_state (
  singleton_key TEXT PRIMARY KEY NOT NULL CHECK (singleton_key='PRIMARY'),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation>=0),
  normalization_version INTEGER NOT NULL CHECK (normalization_version=1)
);
INSERT INTO catalog_state(singleton_key,generation,normalization_version) VALUES('PRIMARY',0,1);
CREATE TABLE catalog_command_receipts (
  command_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK (recovery_epoch>=0),
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);

-- Add only the new policy grant. Never restore any preexisting permission.
INSERT OR IGNORE INTO permissions(code,description) VALUES('CATALOG_IMPORT','Import commercial catalog');
INSERT OR IGNORE INTO role_permissions(role_id,permission_code)
SELECT id,'CATALOG_IMPORT' FROM roles WHERE name IN ('OWNER','MANAGER');
PRAGMA user_version=16;
COMMIT;
