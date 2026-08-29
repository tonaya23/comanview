BEGIN;

CREATE TABLE `edge_control_documents` (
  `document_id` TEXT PRIMARY KEY NOT NULL,
  `document_type` TEXT NOT NULL,
  `revision` INTEGER NOT NULL,
  `document_hash` TEXT NOT NULL,
  `envelope_json` TEXT NOT NULL,
  `payload_json` TEXT NOT NULL,
  `issued_at` INTEGER NOT NULL,
  `expires_at` INTEGER,
  `grace_until` INTEGER,
  `received_at` INTEGER NOT NULL,
  `is_current` INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT `chk_edge_control_document_type`
    CHECK (`document_type` IN ('LICENSE', 'FEATURE_FLAGS', 'CONFIGURATION')),
  UNIQUE (`document_type`, `revision`),
  UNIQUE (`document_type`, `document_hash`)
);

CREATE UNIQUE INDEX `unq_edge_current_control_document`
  ON `edge_control_documents` (`document_type`) WHERE `is_current` = 1;

CREATE TABLE `edge_control_runtime` (
  `singleton_key` TEXT PRIMARY KEY NOT NULL DEFAULT 'PRIMARY',
  `desired_control_revision` INTEGER NOT NULL DEFAULT 0,
  `last_successful_pull_at` INTEGER,
  `last_cloud_time` INTEGER,
  `effective_time_floor` INTEGER,
  `last_wall_time` INTEGER,
  `last_checkpoint_at` INTEGER,
  `clock_status` TEXT NOT NULL DEFAULT 'TRUSTED',
  `cloud_reachable` INTEGER NOT NULL DEFAULT 0,
  `last_error` TEXT,
  `sticky_declared_state` TEXT,
  `protected_capabilities_json` TEXT NOT NULL DEFAULT '[]',
  `restriction_started_at` INTEGER,
  `recovery_session_consumed` INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT `chk_edge_control_clock_status`
    CHECK (`clock_status` IN ('TRUSTED', 'ROLLBACK_DETECTED', 'FORWARD_JUMP_DETECTED'))
);

INSERT INTO `edge_control_runtime` (`singleton_key`) VALUES ('PRIMARY');

CREATE TABLE `edge_control_ack_outbox` (
  `command_id` TEXT PRIMARY KEY NOT NULL,
  `document_type` TEXT NOT NULL,
  `revision` INTEGER NOT NULL,
  `document_hash` TEXT NOT NULL,
  `applied_at` INTEGER NOT NULL,
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` INTEGER,
  `acked_at` INTEGER,
  `last_error` TEXT,
  UNIQUE (`document_type`, `revision`)
);

CREATE TABLE `edge_protected_orders` (
  `order_id` TEXT PRIMARY KEY NOT NULL REFERENCES `orders` (`id`),
  `captured_at` INTEGER NOT NULL,
  `license_revision` INTEGER,
  `resolved_at` INTEGER
);

ALTER TABLE `cash_sessions` ADD COLUMN `purpose` TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE `cash_sessions` ADD COLUMN `opened_license_revision` INTEGER;
ALTER TABLE `cash_sessions` ADD COLUMN `opened_license_mode` TEXT;

CREATE TABLE `cash_session_protected_orders` (
  `cash_session_id` TEXT NOT NULL REFERENCES `cash_sessions` (`id`),
  `order_id` TEXT NOT NULL REFERENCES `orders` (`id`),
  PRIMARY KEY (`cash_session_id`, `order_id`)
);

COMMIT;
