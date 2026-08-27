-- Migration: 0007_cash_operations_closure
-- Fase 1N — Cash movements, X/Z reports, blind count and durable closure.

ALTER TABLE `cash_registers` ADD COLUMN `blind_cash_count` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `cash_sessions` ADD COLUMN `closed_by` TEXT;
ALTER TABLE `cash_sessions` ADD COLUMN `close_command_id` TEXT;
ALTER TABLE `cash_sessions` ADD COLUMN `expected_cash_at_close_amount` INTEGER;
ALTER TABLE `cash_sessions` ADD COLUMN `counted_cash_amount` INTEGER;
ALTER TABLE `cash_sessions` ADD COLUMN `difference_amount` INTEGER;
CREATE UNIQUE INDEX `unq_cash_session_close_command`
  ON `cash_sessions` (`close_command_id`)
  WHERE `close_command_id` IS NOT NULL;

CREATE TABLE `cash_movements` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `cash_session_id` TEXT NOT NULL REFERENCES `cash_sessions`(`id`),
  `movement_type` TEXT NOT NULL CHECK (`movement_type` IN ('CASH_IN', 'CASH_OUT')),
  `amount` INTEGER NOT NULL CHECK (`amount` > 0),
  `currency` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `actor_user_id` TEXT NOT NULL,
  `occurred_at` INTEGER NOT NULL,
  `command_id` TEXT NOT NULL UNIQUE
);
CREATE INDEX `idx_cash_movements_session` ON `cash_movements` (`cash_session_id`, `occurred_at`);

CREATE TABLE `cash_reports` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `cash_session_id` TEXT NOT NULL REFERENCES `cash_sessions`(`id`),
  `report_type` TEXT NOT NULL CHECK (`report_type` IN ('X', 'Z')),
  `snapshot_json` TEXT NOT NULL,
  `generated_at` INTEGER NOT NULL,
  `generated_by` TEXT NOT NULL,
  `command_id` TEXT NOT NULL UNIQUE
);
CREATE INDEX `idx_cash_reports_session` ON `cash_reports` (`cash_session_id`, `generated_at`);
CREATE UNIQUE INDEX `unq_cash_session_z_report`
  ON `cash_reports` (`cash_session_id`)
  WHERE `report_type` = 'Z';

-- Cash reports share the durable print queue. Cash jobs have no Order and
-- reference their CashSession instead.
PRAGMA foreign_keys = OFF;
CREATE TABLE `print_jobs_v2` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `order_id` TEXT REFERENCES `orders`(`id`),
  `cash_session_id` TEXT REFERENCES `cash_sessions`(`id`),
  `round_id` TEXT REFERENCES `rounds`(`id`),
  `station_id` TEXT,
  `target_id` TEXT REFERENCES `print_targets`(`id`),
  `job_type` TEXT NOT NULL CHECK (`job_type` IN ('STATION_TICKET', 'PRECHECK', 'CUSTOMER_RECEIPT', 'X_REPORT', 'Z_REPORT')),
  `payload` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('PENDING', 'SENDING', 'DELIVERED', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'CANCELLED')),
  `attempts` INTEGER NOT NULL DEFAULT 0 CHECK (`attempts` >= 0),
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `next_attempt_at` INTEGER,
  `last_error` TEXT,
  `parent_job_id` TEXT REFERENCES `print_jobs_v2`(`id`),
  `dedupe_key` TEXT NOT NULL UNIQUE
);
INSERT INTO `print_jobs_v2` (
  `id`, `tenant_id`, `location_id`, `order_id`, `cash_session_id`, `round_id`, `station_id`,
  `target_id`, `job_type`, `payload`, `status`, `attempts`, `created_at`, `updated_at`,
  `next_attempt_at`, `last_error`, `parent_job_id`, `dedupe_key`
)
SELECT
  `id`, `tenant_id`, `location_id`, `order_id`, NULL, `round_id`, `station_id`, `target_id`,
  `job_type`, `payload`, `status`, `attempts`, `created_at`, `updated_at`, `next_attempt_at`,
  `last_error`, `parent_job_id`, `dedupe_key`
FROM `print_jobs`;
DROP TABLE `print_jobs`;
ALTER TABLE `print_jobs_v2` RENAME TO `print_jobs`;
CREATE INDEX `idx_print_jobs_processable` ON `print_jobs` (`status`, `next_attempt_at`, `created_at`);
CREATE INDEX `idx_print_jobs_order_id` ON `print_jobs` (`order_id`);
CREATE INDEX `idx_print_jobs_cash_session_id` ON `print_jobs` (`cash_session_id`);
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO `permissions` (`code`, `description`) VALUES
  ('CASH_MOVEMENT_CREATE', 'CASH_MOVEMENT_CREATE'),
  ('CASH_REPORT_X', 'CASH_REPORT_X'),
  ('CASH_SESSION_CLOSE', 'CASH_SESSION_CLOSE');

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT `id`, permission.code
FROM `roles`
CROSS JOIN (
  SELECT 'CASH_MOVEMENT_CREATE' AS code
  UNION ALL SELECT 'CASH_REPORT_X'
  UNION ALL SELECT 'CASH_SESSION_CLOSE'
) AS permission
WHERE `name` IN ('OWNER', 'MANAGER', 'CASHIER');
