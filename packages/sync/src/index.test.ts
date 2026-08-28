import { describe, expect, it } from 'vitest';
import {
  SYNC_EVENT_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  SyncBatchRequestSchema,
  SyncEventEnvelopeSchema,
  calculateRetryDelayMs,
} from './index.js';

const envelope = {
  schemaVersion: SYNC_EVENT_SCHEMA_VERSION,
  eventId: '01991a00-0000-7000-8000-000000000901',
  eventType: 'ORDER_CREATED',
  aggregateType: 'ORDER',
  aggregateId: '01991a00-0000-7000-8000-000000000902',
  tenantId: '01991a00-0000-7000-8000-000000000301',
  locationId: '01991a00-0000-7000-8000-000000000302',
  edgeId: '01991a00-0000-7000-8000-000000000903',
  occurredAt: '2026-08-27T12:00:00.000Z',
  localSequence: 1,
  aggregateVersion: 1,
  payload: { orderId: '01991a00-0000-7000-8000-000000000902' },
};

describe('Edge to Cloud sync contract', () => {
  it('validates a versioned event envelope and batch', () => {
    expect(SyncEventEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      SyncBatchRequestSchema.parse({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        edgeId: envelope.edgeId,
        tenantId: envelope.tenantId,
        locationId: envelope.locationId,
        batchId: '01991a00-0000-7000-8000-000000000904',
        events: [envelope],
      }).events,
    ).toHaveLength(1);
  });

  it('rejects invalid identifiers and timestamps', () => {
    expect(SyncEventEnvelopeSchema.safeParse({ ...envelope, eventId: 'not-an-id' }).success).toBe(
      false,
    );
    expect(
      SyncEventEnvelopeSchema.safeParse({ ...envelope, occurredAt: 'yesterday' }).success,
    ).toBe(false);
  });

  it('uses bounded exponential backoff with deterministic jitter injection', () => {
    expect(calculateRetryDelayMs(1, () => 0.5)).toBe(1_000);
    expect(calculateRetryDelayMs(8, () => 0.5)).toBe(120_000);
    expect(calculateRetryDelayMs(99, () => 0.5)).toBe(120_000);
  });
});
