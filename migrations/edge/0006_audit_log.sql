-- Migration: 0006_audit_log
-- Fase 1M — Durable append-only local Audit Log.

CREATE TABLE IF NOT EXISTS `audit_log` (
  `audit_id` TEXT PRIMARY KEY NOT NULL,
  `occurred_at` INTEGER NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `device_id` TEXT NOT NULL,
  `session_id` TEXT NOT NULL,
  `actor_user_id` TEXT NOT NULL,
  `actor_role` TEXT,
  `authorized_by_user_id` TEXT,
  `authorized_by_role` TEXT,
  `action` TEXT NOT NULL,
  `entity_type` TEXT NOT NULL,
  `entity_id` TEXT NOT NULL,
  `outcome` TEXT NOT NULL,
  `reason` TEXT NOT NULL,
  `command_id` TEXT,
  `before_json` TEXT,
  `after_json` TEXT,
  `amount_affected` INTEGER,
  `currency` TEXT,
  `event_id` TEXT,
  `previous_hash` TEXT,
  `entry_hash` TEXT NOT NULL UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS `unq_audit_command_action`
  ON `audit_log` (`command_id`, `action`)
  WHERE `command_id` IS NOT NULL;
CREATE INDEX IF NOT EXISTS `idx_audit_recent`
  ON `audit_log` (`location_id`, `occurred_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_audit_actor`
  ON `audit_log` (`actor_user_id`, `occurred_at` DESC);
CREATE INDEX IF NOT EXISTS `idx_audit_resource`
  ON `audit_log` (`entity_id`, `occurred_at` DESC);

INSERT OR IGNORE INTO `permissions` (`code`, `description`)
VALUES ('AUDIT_VIEW', 'AUDIT_VIEW');

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT `id`, 'AUDIT_VIEW'
FROM `roles`
WHERE `name` IN ('OWNER', 'MANAGER');
