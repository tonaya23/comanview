PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE IF NOT EXISTS `restaurant_tables` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `zone` TEXT,
  `capacity` INTEGER,
  `display_order` INTEGER NOT NULL DEFAULT 0,
  `active` INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS `idx_restaurant_tables_location`
  ON `restaurant_tables` (`location_id`, `active`, `display_order`);

ALTER TABLE `order_table_assignments` RENAME TO `order_table_assignments_legacy`;

CREATE TABLE `order_table_assignments` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `order_id` TEXT NOT NULL REFERENCES `orders` (`id`),
  `table_id` TEXT NOT NULL,
  `assigned_at` INTEGER NOT NULL,
  `released_at` INTEGER,
  `command_id` TEXT
);

INSERT INTO `order_table_assignments`
  (`id`, `order_id`, `table_id`, `assigned_at`, `released_at`, `command_id`)
SELECT
  lower(hex(randomblob(16))),
  legacy.`order_id`,
  legacy.`table_id`,
  orders.`created_at`,
  CASE WHEN orders.`status` = 'OPEN' THEN NULL ELSE orders.`created_at` END,
  NULL
FROM `order_table_assignments_legacy` legacy
JOIN `orders` ON orders.`id` = legacy.`order_id`;

DROP TABLE `order_table_assignments_legacy`;

CREATE UNIQUE INDEX `unq_active_table_assignment`
  ON `order_table_assignments` (`table_id`)
  WHERE `released_at` IS NULL;

CREATE INDEX `idx_order_table_assignment_order`
  ON `order_table_assignments` (`order_id`, `released_at`);

INSERT OR IGNORE INTO `permissions` (`code`, `description`)
VALUES ('ORDER_CANCEL_EMPTY', 'Cancel an empty TABLE Order and release its tables');

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT `id`, 'ORDER_CANCEL_EMPTY'
FROM `roles`
WHERE `name` = 'WAITER';

COMMIT;

PRAGMA foreign_keys = ON;
