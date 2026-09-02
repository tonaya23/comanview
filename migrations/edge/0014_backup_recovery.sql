BEGIN;

ALTER TABLE `edge_installations` ADD COLUMN `recovery_epoch` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `event_log` ADD COLUMN `recovery_epoch` INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER `trg_event_log_recovery_epoch`
AFTER INSERT ON `event_log`
WHEN NEW.`recovery_epoch` = 0
  AND (SELECT `recovery_epoch` FROM `edge_installations` WHERE `singleton_key` = 'PRIMARY') > 0
BEGIN
  UPDATE `event_log`
  SET `recovery_epoch` = (
    SELECT `recovery_epoch` FROM `edge_installations` WHERE `singleton_key` = 'PRIMARY'
  )
  WHERE `id` = NEW.`id`;
END;

CREATE TABLE `backup_records` (
  `backup_id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `source_edge_id` TEXT NOT NULL,
  `recovery_epoch` INTEGER NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('CREATING','VERIFIED','FAILED','DELETED')),
  `trigger` TEXT NOT NULL CHECK (`trigger` IN ('PERIODIC','MANUAL','POST_Z','PRE_MAINTENANCE','SAFETY')),
  `destination_type` TEXT NOT NULL CHECK (`destination_type` IN ('LOCAL','OFF_DEVICE')),
  `artifact_path` TEXT NOT NULL,
  `format_version` INTEGER NOT NULL,
  `schema_version` INTEGER NOT NULL,
  `application_version` TEXT NOT NULL,
  `business_date` TEXT,
  `created_at` INTEGER NOT NULL,
  `completed_at` INTEGER,
  `verified_at` INTEGER,
  `size_bytes` INTEGER,
  `ciphertext_sha256` TEXT,
  `failure_code` TEXT,
  `failure_detail` TEXT,
  `command_id` TEXT UNIQUE
);
CREATE INDEX `idx_backup_records_recent`
  ON `backup_records` (`status`, `created_at` DESC);

CREATE TABLE `backup_runtime` (
  `singleton_key` TEXT PRIMARY KEY NOT NULL DEFAULT 'PRIMARY',
  `next_periodic_backup_at` INTEGER,
  `last_attempt_at` INTEGER,
  `last_successful_backup_at` INTEGER,
  `last_verified_backup_id` TEXT,
  `last_failure_code` TEXT,
  `worker_status` TEXT NOT NULL DEFAULT 'IDLE'
    CHECK (`worker_status` IN ('IDLE','RUNNING','DEGRADED')),
  `updated_at` INTEGER NOT NULL
);
INSERT INTO `backup_runtime` (`singleton_key`,`worker_status`,`updated_at`)
VALUES ('PRIMARY','IDLE',CAST(strftime('%s','now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO `permissions` (`code`,`description`) VALUES
  ('BACKUP_VIEW','BACKUP_VIEW'),
  ('BACKUP_CREATE','BACKUP_CREATE'),
  ('RECOVERY_VIEW','RECOVERY_VIEW'),
  ('RECOVERY_EXECUTE','RECOVERY_EXECUTE');

INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_code`)
SELECT `id`, p.`code`
FROM `roles`
CROSS JOIN (
  SELECT 'BACKUP_VIEW' AS `code`
  UNION ALL SELECT 'BACKUP_CREATE'
  UNION ALL SELECT 'RECOVERY_VIEW'
) p
WHERE `roles`.`name` IN ('OWNER','MANAGER');

INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_code`)
SELECT `id`, 'RECOVERY_EXECUTE'
FROM `roles`
WHERE `roles`.`name` = 'OWNER';

COMMIT;
