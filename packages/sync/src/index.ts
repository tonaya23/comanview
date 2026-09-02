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

import { z } from 'zod';

export const SYNC_PROTOCOL_VERSION = '1' as const;
export const SYNC_EVENT_SCHEMA_VERSION = 1 as const;
export const MAX_SYNC_BATCH_SIZE = 100;
export const DEFAULT_SYNC_BATCH_SIZE = 50;

const JsonObjectSchema = z.record(z.unknown());

export const SyncEventEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  eventId: z.string().uuid(),
  eventType: z.string().min(1).max(120),
  aggregateType: z.string().min(1).max(80),
  aggregateId: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  localSequence: z.number().int().nonnegative(),
  recoveryEpoch: z.number().int().nonnegative().default(0),
  aggregateVersion: z.number().int().nonnegative().nullable(),
  payload: JsonObjectSchema,
});
export type SyncEventEnvelope = z.input<typeof SyncEventEnvelopeSchema>;

export const SyncBatchRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  edgeId: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  batchId: z.string().uuid(),
  events: z.array(SyncEventEnvelopeSchema).min(1).max(MAX_SYNC_BATCH_SIZE),
});
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;

export const SyncRejectedEventSchema = z.object({
  eventId: z.string().uuid(),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
});

export const SyncBatchAckSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  batchId: z.string().uuid(),
  accepted: z.array(z.string().uuid()),
  duplicates: z.array(z.string().uuid()),
  rejected: z.array(SyncRejectedEventSchema),
});
export type SyncBatchAck = z.infer<typeof SyncBatchAckSchema>;

export const EdgeHeartbeatSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  edgeId: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeVersion: z.string().min(1).max(80),
  schemaVersion: z.string().min(1).max(80),
  timestamp: z.string().datetime(),
  status: z.enum(['ONLINE', 'DEGRADED']),
  pendingEventCount: z.number().int().nonnegative(),
});
export type EdgeHeartbeat = z.infer<typeof EdgeHeartbeatSchema>;

export const HeartbeatAckSchema = z.object({
  edgeId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  desiredControlRevision: z.number().int().nonnegative().optional(),
});
export type HeartbeatAck = z.infer<typeof HeartbeatAckSchema>;

export const SyncStatusSchema = z.object({
  enabled: z.boolean(),
  edgeId: z.string().uuid(),
  cloudReachable: z.boolean().nullable(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  lastHeartbeatAt: z.string().datetime().nullable(),
  pendingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  syncingCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export function inferAggregateType(eventType: string): string {
  if (eventType.startsWith('CASH_')) return 'CASH_SESSION';
  return 'ORDER';
}

export function calculateRetryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 7);
  const base = Math.min(1_000 * 2 ** exponent, 120_000);
  return Math.round(base * (0.8 + random() * 0.4));
}
