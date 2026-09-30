BEGIN;

ALTER TABLE modifier_groups ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991);
ALTER TABLE modifier_options ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991);

PRAGMA user_version = 18;

COMMIT;
