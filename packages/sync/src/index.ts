/**
 * @comanview/sync
 *
 * Edge Outbox / Cloud Inbox sync protocol types and utilities.
 *
 * RULES:
 * - Business mutation and its synchronizable event MUST be committed atomically.
 * - Duplicate event_id MUST produce one logical Cloud effect (idempotent Inbox).
 * - Sync batches MAY be partially accepted.
 * - Only acknowledged events may become SYNCED.
 * - WebSocket is notification transport, NOT transactional authority.
 */

export {};
