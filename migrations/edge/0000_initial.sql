-- Migration: 0000_initial
-- ComanView Edge SQLite schema (Fase 1E)
-- All monetary values stored as INTEGER (minor units). Never REAL/FLOAT.
-- All tax rates stored as INTEGER (basis points). Never REAL/FLOAT.
-- All UUIDs stored as TEXT.
-- WAL mode and FK enforcement are configured at connection time (not here).

PRAGMA journal_mode = WAL;

-- ─── INFRASTRUCTURE ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `processed_commands` (
  `command_id` TEXT PRIMARY KEY NOT NULL,
  `processed_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `event_log` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `event_type` TEXT NOT NULL,
  `aggregate_id` TEXT NOT NULL,
  `version` INTEGER,
  `payload` TEXT NOT NULL,
  `occurred_at` INTEGER NOT NULL,
  `command_id` TEXT,
  `sync_status` TEXT NOT NULL DEFAULT 'PENDING'
);

-- ─── CATALOG ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `categories` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `active` INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `tax_profiles` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `rate_basis_points` INTEGER NOT NULL,
  `calculation_mode` TEXT NOT NULL,
  `active` INTEGER NOT NULL DEFAULT 1,
  `is_default` INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `modifier_groups` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `min_selections` INTEGER NOT NULL DEFAULT 0,
  `max_selections` INTEGER NOT NULL DEFAULT 1,
  `active` INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `modifier_options` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `group_id` TEXT NOT NULL REFERENCES `modifier_groups`(`id`),
  `name` TEXT NOT NULL,
  `price_delta_amount` INTEGER NOT NULL DEFAULT 0,
  `price_delta_currency` TEXT NOT NULL,
  `active` INTEGER NOT NULL DEFAULT 1,
  `available` INTEGER NOT NULL DEFAULT 1,
  `display_order` INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `products` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `description` TEXT NOT NULL DEFAULT '',
  `product_type` TEXT NOT NULL DEFAULT 'STANDARD',
  `category_id` TEXT REFERENCES `categories`(`id`),
  `tax_profile_id` TEXT NOT NULL REFERENCES `tax_profiles`(`id`),
  `base_price_amount` INTEGER NOT NULL,
  `base_price_currency` TEXT NOT NULL,
  `station_id` TEXT,
  `sku` TEXT,
  `barcode` TEXT,
  `display_order` INTEGER NOT NULL DEFAULT 0,
  `active` INTEGER NOT NULL DEFAULT 1,
  `available` INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS `product_modifier_groups` (
  `product_id` TEXT NOT NULL REFERENCES `products`(`id`),
  `modifier_group_id` TEXT NOT NULL REFERENCES `modifier_groups`(`id`),
  `display_order` INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_product_modifier_group`
  ON `product_modifier_groups`(`product_id`, `modifier_group_id`);

CREATE TABLE IF NOT EXISTS `modifier_price_overrides` (
  `product_id` TEXT NOT NULL REFERENCES `products`(`id`),
  `modifier_option_id` TEXT NOT NULL REFERENCES `modifier_options`(`id`),
  `price_delta_amount` INTEGER NOT NULL,
  `price_delta_currency` TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_modifier_price_override`
  ON `modifier_price_overrides`(`product_id`, `modifier_option_id`);

-- ─── ORDERS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `orders` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `order_type` TEXT NOT NULL,
  `order_channel` TEXT NOT NULL,
  `order_number` TEXT NOT NULL,
  `currency` TEXT NOT NULL,
  `status` TEXT NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `order_table_assignments` (
  `order_id` TEXT NOT NULL REFERENCES `orders`(`id`),
  `table_id` TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_order_table_assignment`
  ON `order_table_assignments`(`order_id`, `table_id`);

CREATE TABLE IF NOT EXISTS `rounds` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `order_id` TEXT NOT NULL REFERENCES `orders`(`id`),
  `round_number` INTEGER NOT NULL,
  `sent_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `order_id` TEXT NOT NULL REFERENCES `orders`(`id`),
  -- Snapshot fields (historical, must NOT be recalculated from current catalog)
  `product_id` TEXT NOT NULL,
  `product_name` TEXT NOT NULL,
  `base_price_amount` INTEGER NOT NULL,
  `base_price_currency` TEXT NOT NULL,
  `tax_rate_basis_points` INTEGER NOT NULL,
  `tax_calculation_mode` TEXT NOT NULL,
  `station_id` TEXT,
  -- Item state
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `send_status` TEXT NOT NULL,
  `prep_status` TEXT NOT NULL,
  `round_id` TEXT REFERENCES `rounds`(`id`)
);

CREATE TABLE IF NOT EXISTS `order_item_modifiers` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `order_item_id` TEXT NOT NULL REFERENCES `order_items`(`id`),
  -- Snapshot fields (historical price delta at time of order)
  `modifier_option_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `price_delta_amount` INTEGER NOT NULL,
  `price_delta_currency` TEXT NOT NULL
);
