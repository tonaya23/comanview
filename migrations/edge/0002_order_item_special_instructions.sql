-- Migration: 0002_order_item_special_instructions
-- Fase 1I.1 — transactional preparation notes owned by OrderItem.

ALTER TABLE `order_items` ADD COLUMN `special_instructions` TEXT;
