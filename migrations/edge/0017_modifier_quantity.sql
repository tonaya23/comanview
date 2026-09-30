BEGIN;

ALTER TABLE order_item_modifiers ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(quantity) = 'integer' AND quantity >= 1 AND quantity <= 9007199254740991);

PRAGMA user_version = 17;

COMMIT;
