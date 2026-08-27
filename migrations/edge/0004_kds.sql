-- Migration: 0004_kds
-- Fase 1K — persistent preparation timestamps on authoritative OrderItems.

ALTER TABLE `order_items` ADD COLUMN `prep_started_at` INTEGER;
ALTER TABLE `order_items` ADD COLUMN `ready_at` INTEGER;

CREATE INDEX IF NOT EXISTS `idx_order_items_kds_station_status`
  ON `order_items`(`station_id`, `send_status`, `prep_status`, `round_id`);
