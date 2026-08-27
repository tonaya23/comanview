-- Migration: 0003_printing
-- Fase 1J — durable local printing queue and data-driven station routing.

CREATE TABLE IF NOT EXISTS `stations` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `active` INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `print_targets` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `station_id` TEXT REFERENCES `stations`(`id`),
  `name` TEXT NOT NULL,
  `adapter_type` TEXT NOT NULL CHECK (`adapter_type` IN ('DEBUG', 'TCP_ESC_POS', 'USB_ESC_POS')),
  `configuration_json` TEXT NOT NULL DEFAULT '{}',
  `active` INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_active_print_target_station`
  ON `print_targets`(`location_id`, `station_id`)
  WHERE `active` = 1 AND `station_id` IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `unq_active_default_print_target`
  ON `print_targets`(`location_id`)
  WHERE `active` = 1 AND `station_id` IS NULL;

CREATE TABLE IF NOT EXISTS `print_jobs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `order_id` TEXT NOT NULL REFERENCES `orders`(`id`),
  `round_id` TEXT REFERENCES `rounds`(`id`),
  `station_id` TEXT,
  `target_id` TEXT REFERENCES `print_targets`(`id`),
  `job_type` TEXT NOT NULL CHECK (`job_type` IN ('STATION_TICKET', 'PRECHECK', 'CUSTOMER_RECEIPT')),
  `payload` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('PENDING', 'SENDING', 'DELIVERED', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'CANCELLED')),
  `attempts` INTEGER NOT NULL DEFAULT 0 CHECK (`attempts` >= 0),
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `next_attempt_at` INTEGER,
  `last_error` TEXT,
  `parent_job_id` TEXT REFERENCES `print_jobs`(`id`),
  `dedupe_key` TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS `idx_print_jobs_processable`
  ON `print_jobs`(`status`, `next_attempt_at`, `created_at`);
CREATE INDEX IF NOT EXISTS `idx_print_jobs_order_id` ON `print_jobs`(`order_id`);
