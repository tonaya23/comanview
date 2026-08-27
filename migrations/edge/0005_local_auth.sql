-- Migration: 0005_local_auth
-- Fase 1L — Offline-first local users, RBAC, devices and sessions.

CREATE TABLE IF NOT EXISTS `roles` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS `permissions` (
  `code` TEXT PRIMARY KEY NOT NULL,
  `description` TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` TEXT NOT NULL REFERENCES `roles`(`id`),
  `permission_code` TEXT NOT NULL REFERENCES `permissions`(`code`),
  PRIMARY KEY (`role_id`, `permission_code`)
);

CREATE TABLE IF NOT EXISTS `users` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `display_name` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('ACTIVE', 'DISABLED')),
  `pin_hash` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `user_roles` (
  `user_id` TEXT NOT NULL REFERENCES `users`(`id`),
  `role_id` TEXT NOT NULL REFERENCES `roles`(`id`),
  PRIMARY KEY (`user_id`, `role_id`)
);

CREATE TABLE IF NOT EXISTS `devices` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `device_type` TEXT NOT NULL CHECK (`device_type` IN ('POS', 'WAITER', 'KDS')),
  `status` TEXT NOT NULL CHECK (`status` IN ('ACTIVE', 'REVOKED')),
  `session_timeout_minutes` INTEGER NOT NULL CHECK (`session_timeout_minutes` > 0),
  `created_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL REFERENCES `users`(`id`),
  `device_id` TEXT NOT NULL REFERENCES `devices`(`id`),
  `tenant_id` TEXT NOT NULL,
  `location_id` TEXT NOT NULL,
  `token_hash` TEXT NOT NULL UNIQUE,
  `login_at` INTEGER NOT NULL,
  `last_activity` INTEGER NOT NULL,
  `expires_at` INTEGER NOT NULL,
  `revoked_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `login_attempts` (
  `device_id` TEXT PRIMARY KEY NOT NULL REFERENCES `devices`(`id`),
  `failed_attempts` INTEGER NOT NULL DEFAULT 0,
  `locked_until` INTEGER,
  `updated_at` INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_users_location_status`
  ON `users`(`tenant_id`, `location_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_auth_sessions_token`
  ON `auth_sessions`(`token_hash`);
CREATE INDEX IF NOT EXISTS `idx_auth_sessions_expiration`
  ON `auth_sessions`(`expires_at`, `revoked_at`);
