-- Migration: 0001_payments_cash
-- Fase 1H — Payments + Cash vertical slice.
-- Monetary values remain INTEGER minor units. Payment history is never deleted.

CREATE TABLE IF NOT EXISTS `cash_registers` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `currency` TEXT NOT NULL,
  `active` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `cash_sessions` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `cash_register_id` TEXT NOT NULL REFERENCES `cash_registers`(`id`),
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `opening_float_amount` INTEGER NOT NULL CHECK (`opening_float_amount` >= 0),
  `currency` TEXT NOT NULL,
  `business_date` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('OPEN', 'CLOSED')),
  `opened_at` INTEGER NOT NULL,
  `opened_by` TEXT NOT NULL,
  `closed_at` INTEGER,
  `open_command_id` TEXT NOT NULL UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_cash_register_open_session`
  ON `cash_sessions`(`cash_register_id`)
  WHERE `status` = 'OPEN';

CREATE TABLE IF NOT EXISTS `payments` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `order_id` TEXT NOT NULL REFERENCES `orders`(`id`),
  `cash_session_id` TEXT NOT NULL REFERENCES `cash_sessions`(`id`),
  `method` TEXT NOT NULL CHECK (`method` IN ('CASH', 'CARD', 'OTHER')),
  `amount_applied_amount` INTEGER NOT NULL CHECK (`amount_applied_amount` > 0),
  `tip_amount` INTEGER NOT NULL CHECK (`tip_amount` >= 0),
  `currency` TEXT NOT NULL,
  `cash_tendered_amount` INTEGER,
  `change_given_amount` INTEGER NOT NULL CHECK (`change_given_amount` >= 0),
  `status` TEXT NOT NULL CHECK (`status` IN ('PENDING', 'COMPLETED', 'VOIDED')),
  `external_reference` TEXT,
  `command_id` TEXT NOT NULL UNIQUE,
  `created_at` INTEGER NOT NULL,
  `completed_at` INTEGER,
  `voided_at` INTEGER
);

CREATE INDEX IF NOT EXISTS `idx_payments_order_id` ON `payments`(`order_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_cash_session_id` ON `payments`(`cash_session_id`);
