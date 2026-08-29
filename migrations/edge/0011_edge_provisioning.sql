BEGIN;

ALTER TABLE `edge_installations` ADD COLUMN `provisioning_state` TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE `edge_installations` ADD COLUMN `credential_id` TEXT;
ALTER TABLE `edge_installations` ADD COLUMN `provisioning_attempt_id` TEXT;
ALTER TABLE `edge_installations` ADD COLUMN `provisioned_at` INTEGER;
ALTER TABLE `edge_installations` ADD COLUMN `activated_at` INTEGER;

UPDATE `edge_installations`
SET `provisioned_at` = `created_at`,
    `activated_at` = `created_at`
WHERE `provisioning_state` = 'ACTIVE';

CREATE TABLE `edge_provisioning_journal` (
  `singleton_key` TEXT PRIMARY KEY NOT NULL DEFAULT 'PRIMARY',
  `edge_id` TEXT NOT NULL,
  `attempt_id` TEXT NOT NULL,
  `credential_id` TEXT NOT NULL,
  `state` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  CONSTRAINT `chk_edge_provisioning_journal_state`
    CHECK (`state` IN ('CREDENTIAL_STORED', 'EXCHANGED', 'ACTIVE'))
);

COMMIT;
