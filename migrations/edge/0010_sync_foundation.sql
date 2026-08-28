BEGIN;

ALTER TABLE `event_log` ADD COLUMN `aggregate_type` TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE `event_log` ADD COLUMN `local_sequence` INTEGER;
ALTER TABLE `event_log` ADD COLUMN `attempt_count` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `event_log` ADD COLUMN `last_attempt_at` INTEGER;
ALTER TABLE `event_log` ADD COLUMN `lease_expires_at` INTEGER;
ALTER TABLE `event_log` ADD COLUMN `next_attempt_at` INTEGER;
ALTER TABLE `event_log` ADD COLUMN `synced_at` INTEGER;
ALTER TABLE `event_log` ADD COLUMN `last_error` TEXT;

UPDATE `event_log`
SET `local_sequence` = rowid,
    `aggregate_type` = CASE
      WHEN `event_type` LIKE 'CASH_%' THEN 'CASH_SESSION'
      ELSE 'ORDER'
    END
WHERE `local_sequence` IS NULL;

CREATE UNIQUE INDEX `unq_event_log_local_sequence`
  ON `event_log` (`local_sequence`);

CREATE INDEX `idx_event_log_sync_claim`
  ON `event_log` (`sync_status`, `next_attempt_at`, `lease_expires_at`, `occurred_at`, `local_sequence`);

CREATE TRIGGER `trg_event_log_local_sequence`
AFTER INSERT ON `event_log`
WHEN NEW.`local_sequence` IS NULL
BEGIN
  UPDATE `event_log`
  SET `local_sequence` = (
    SELECT COALESCE(MAX(`local_sequence`), 0) + 1
    FROM `event_log`
    WHERE `id` <> NEW.`id`
  )
  WHERE `id` = NEW.`id`;
END;

CREATE TABLE `edge_installations` (
  `singleton_key` TEXT PRIMARY KEY NOT NULL CHECK (`singleton_key` = 'PRIMARY'),
  `edge_id` TEXT NOT NULL UNIQUE,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL
);

CREATE TABLE `sync_runtime_state` (
  `singleton_key` TEXT PRIMARY KEY NOT NULL CHECK (`singleton_key` = 'PRIMARY'),
  `cloud_reachable` INTEGER,
  `last_successful_sync_at` INTEGER,
  `last_heartbeat_at` INTEGER,
  `last_error` TEXT
);

INSERT INTO `sync_runtime_state` (`singleton_key`) VALUES ('PRIMARY');

COMMIT;
