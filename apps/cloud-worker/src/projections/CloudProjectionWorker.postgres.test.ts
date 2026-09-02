import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CloudProjectionRepository,
  CloudSyncRepository,
  createCloudDatabase,
  migrateCloudDatabase,
  type ClaimedCloudEvent,
} from '@comanview/database';
import type { CloudWorkerConfig } from '@comanview/config';
import type { SyncEventEnvelope } from '@comanview/sync';
import { CloudProjectionWorker } from './CloudProjectionWorker.js';

const databaseUrl = process.env['COMANVIEW_TEST_POSTGRES_URL'];
const projectionVersion = 1;
const logger = { info() {}, warn() {}, error() {} };

function workerConfig(overrides: Partial<CloudWorkerConfig> = {}): CloudWorkerConfig {
  return {
    databaseUrl: databaseUrl!,
    projectionVersion,
    pollIntervalMs: 1_000,
    leaseDurationMs: 1_000,
    batchSize: 25,
    maxAttempts: 3,
    ...overrides,
  };
}

describe.skipIf(!databaseUrl)('Cloud projection worker with PostgreSQL', () => {
  const database = createCloudDatabase(databaseUrl!);
  const syncRepository = new CloudSyncRepository(database.db);
  const projectionRepository = new CloudProjectionRepository(database.pool);
  const edges: string[] = [];

  beforeAll(async () => {
    await migrateCloudDatabase(databaseUrl!);
  });

  afterAll(async () => {
    for (const edgeId of edges) await deleteEdgeData(edgeId);
    await database.close();
  });

  async function createEdge() {
    const edge = {
      edgeId: randomUUID(),
      tenantId: randomUUID(),
      locationId: randomUUID(),
      credentialHash: 'projection-test-hash',
    };
    edges.push(edge.edgeId);
    await syncRepository.provisionEdge(edge);
    return edge;
  }

  async function deleteEdgeData(edgeId: string) {
    const binding = await database.pool.query<{ tenant_id: string; location_id: string }>('SELECT tenant_id,location_id FROM edges WHERE edge_id=$1', [edgeId]);
    await database.pool.query('DELETE FROM cloud_projection_event_receipts WHERE edge_id = $1', [
      edgeId,
    ]);
    await database.pool.query('DELETE FROM cloud_projection_checkpoints WHERE edge_id = $1', [
      edgeId,
    ]);
    for (const table of [
      'cloud_cash_movements',
      'cloud_cash_session_summaries',
      'cloud_closed_sale_summaries',
      'cloud_payment_summaries',
      'cloud_order_operational_summaries',
    ]) {
      await database.pool.query(`DELETE FROM ${table} WHERE edge_id = $1`, [edgeId]);
    }
    await database.pool.query('DELETE FROM edge_heartbeats WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM cloud_sync_inbox WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edge_credentials WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edges WHERE edge_id = $1', [edgeId]);
    if (binding.rows[0]) {
      await database.pool.query('DELETE FROM cloud_locations WHERE location_id=$1', [binding.rows[0].location_id]);
      await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1', [binding.rows[0].tenant_id]);
    }
  }

  function event(
    edge: Awaited<ReturnType<typeof createEdge>>,
    input: {
      sequence: number;
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
      schemaVersion?: number;
      recoveryEpoch?:number;
    },
  ): SyncEventEnvelope {
    return {
      schemaVersion: input.schemaVersion ?? 1,
      eventId: randomUUID(),
      eventType: input.eventType,
      aggregateType: input.eventType.startsWith('CASH_') ? 'CASH_SESSION' : 'ORDER',
      aggregateId: input.aggregateId,
      aggregateVersion: input.sequence,
      tenantId: edge.tenantId,
      locationId: edge.locationId,
      edgeId: edge.edgeId,
      occurredAt: new Date(Date.UTC(2026, 7, 27, 12, 0, input.sequence)).toISOString(),
      localSequence: input.sequence,
      recoveryEpoch:input.recoveryEpoch??0,
      payload: input.payload,
    };
  }

  async function ingest(events: SyncEventEnvelope[]) {
    const result = await syncRepository.ingestBatch(randomUUID(), '1', events);
    expect(result.integrityRejected).toEqual([]);
    expect(result.accepted).toHaveLength(events.length);
  }

  it('orders equal local sequences across recovery epochs and advances the checkpoint lexicographically', async () => {
    const edge = await createEdge();
    const aggregateId = randomUUID();
    await ingest([
      event(edge, { sequence: 1, recoveryEpoch: 0, eventType: 'LEGACY_UNKNOWN', aggregateId, payload: {} }),
      event(edge, { sequence: 1, recoveryEpoch: 1, eventType: 'RECOVERED_UNKNOWN', aggregateId, payload: {} }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig({ batchSize: 10 }),
      randomUUID(),
      logger,
    );
    const now = new Date('2026-09-01T12:00:00.000Z');
    expect(await worker.runOnce(now)).toBe(1);
    expect(await worker.runOnce(new Date(now.getTime() + 1))).toBe(1);
    const checkpoint = await database.pool.query<{
      last_recovery_epoch: number;
      last_local_sequence: number;
    }>(
      `SELECT last_recovery_epoch, last_local_sequence
       FROM cloud_projection_checkpoints
       WHERE edge_id = $1 AND projection_version = $2`,
      [edge.edgeId, projectionVersion],
    );
    expect(checkpoint.rows[0]).toEqual({ last_recovery_epoch: 1, last_local_sequence: 1 });
  });

  it('projects Order, Payment and closed Sale without mixing tip into sale amount', async () => {
    const edge = await createEdge();
    const orderId = randomUUID();
    const paymentId = randomUUID();
    const cashSessionId = randomUUID();
    const itemId = randomUUID();
    await ingest([
      event(edge, {
        sequence: 1,
        eventType: 'ORDER_CREATED',
        aggregateId: orderId,
        payload: { orderType: 'COUNTER', orderChannel: 'POS', tableIds: [] },
      }),
      event(edge, {
        sequence: 2,
        eventType: 'ITEM_ADDED',
        aggregateId: orderId,
        payload: { itemId, productName: 'Hamburguesa', specialInstructions: null },
      }),
      event(edge, {
        sequence: 3,
        eventType: 'ROUND_SENT',
        aggregateId: orderId,
        payload: { roundId: randomUUID(), itemIds: [itemId] },
      }),
      event(edge, {
        sequence: 4,
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: orderId,
        payload: {
          paymentId,
          cashSessionId,
          method: 'CASH',
          amountApplied: 12_900,
          tipAmount: 500,
          currency: 'MXN',
        },
      }),
      event(edge, {
        sequence: 5,
        eventType: 'ORDER_CLOSED',
        aggregateId: orderId,
        payload: { orderId },
      }),
    ]);

    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig(),
      randomUUID(),
      logger,
    );
    expect(await worker.drain()).toBeGreaterThanOrEqual(5);
    const receipts = await database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM cloud_projection_event_receipts
       WHERE projection_version = 1 AND edge_id = $1`,
      [edge.edgeId],
    );
    expect(receipts.rows[0]?.count).toBe(5);

    const order = await database.pool.query(
      `SELECT status, item_count, sent_item_count, paid_amount::int, tip_amount::int
       FROM cloud_order_operational_summaries WHERE projection_version = 1 AND order_id = $1`,
      [orderId],
    );
    expect(order.rows[0]).toMatchObject({
      status: 'CLOSED',
      item_count: 1,
      sent_item_count: 1,
      paid_amount: 12_900,
      tip_amount: 500,
    });
    const sale = await database.pool.query(
      `SELECT sale_amount::int, tip_amount::int, charged_total::int, completeness_status
       FROM cloud_closed_sale_summaries WHERE projection_version = 1 AND order_id = $1`,
      [orderId],
    );
    expect(sale.rows[0]).toEqual({
      sale_amount: 12_900,
      tip_amount: 500,
      charged_total: 13_400,
      completeness_status: 'COMPLETE',
    });
  });

  it('projects completed and voided Payments idempotently', async () => {
    const edge = await createEdge();
    const orderId = randomUUID();
    const paymentId = randomUUID();
    await ingest([
      event(edge, {
        sequence: 1,
        eventType: 'ORDER_CREATED',
        aggregateId: orderId,
        payload: { orderType: 'COUNTER', orderChannel: 'POS', tableIds: [] },
      }),
      event(edge, {
        sequence: 2,
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: orderId,
        payload: {
          paymentId,
          cashSessionId: randomUUID(),
          method: 'CARD',
          amountApplied: 5_000,
          tipAmount: 200,
          currency: 'MXN',
        },
      }),
      event(edge, {
        sequence: 3,
        eventType: 'PAYMENT_VOIDED',
        aggregateId: orderId,
        payload: { paymentId },
      }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig(),
      randomUUID(),
      logger,
    );
    expect(await worker.drain()).toBe(3);
    expect(await worker.drain()).toBe(0);

    const payment = await database.pool.query(
      `SELECT status FROM cloud_payment_summaries
       WHERE projection_version = 1 AND payment_id = $1`,
      [paymentId],
    );
    expect(payment.rows[0]?.status).toBe('VOIDED');
    const order = await database.pool.query(
      `SELECT paid_amount::int, tip_amount::int FROM cloud_order_operational_summaries
       WHERE projection_version = 1 AND order_id = $1`,
      [orderId],
    );
    expect(order.rows[0]).toEqual({ paid_amount: 0, tip_amount: 0 });
  });

  it('projects cash opening, movements and closure from authoritative event amounts', async () => {
    const edge = await createEdge();
    const cashSessionId = randomUUID();
    const cashRegisterId = randomUUID();
    await ingest([
      event(edge, {
        sequence: 1,
        eventType: 'CASH_SESSION_OPENED',
        aggregateId: cashSessionId,
        payload: {
          cashSessionId,
          cashRegisterId,
          openingFloat: { amount: 100_000, currency: 'MXN' },
          businessDate: '2026-08-27',
        },
      }),
      event(edge, {
        sequence: 2,
        eventType: 'CASH_MOVEMENT_CREATED',
        aggregateId: cashSessionId,
        payload: {
          cashMovementId: randomUUID(),
          cashSessionId,
          movementType: 'CASH_IN',
          amount: { amount: 10_000, currency: 'MXN' },
          reason: 'Cambio adicional',
          actorUserId: randomUUID(),
        },
      }),
      event(edge, {
        sequence: 3,
        eventType: 'CASH_MOVEMENT_CREATED',
        aggregateId: cashSessionId,
        payload: {
          cashMovementId: randomUUID(),
          cashSessionId,
          movementType: 'CASH_OUT',
          amount: { amount: 2_500, currency: 'MXN' },
          reason: 'Compra local',
          actorUserId: randomUUID(),
        },
      }),
      event(edge, {
        sequence: 4,
        eventType: 'CASH_SESSION_CLOSED',
        aggregateId: cashSessionId,
        payload: {
          cashSessionId,
          businessDate: '2026-08-27',
          expectedCash: { amount: 107_500, currency: 'MXN' },
          countedCash: { amount: 107_000, currency: 'MXN' },
          difference: { amount: -500, currency: 'MXN' },
          closedBy: randomUUID(),
        },
      }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig(),
      randomUUID(),
      logger,
    );
    expect(await worker.drain()).toBe(4);

    const session = await database.pool.query(
      `SELECT status, opening_float_amount::int, cash_in_amount::int, cash_out_amount::int,
              expected_cash_amount::int, counted_cash_amount::int, difference_amount::int
       FROM cloud_cash_session_summaries
       WHERE projection_version = 1 AND cash_session_id = $1`,
      [cashSessionId],
    );
    expect(session.rows[0]).toEqual({
      status: 'CLOSED',
      opening_float_amount: 100_000,
      cash_in_amount: 10_000,
      cash_out_amount: 2_500,
      expected_cash_amount: 107_500,
      counted_cash_amount: 107_000,
      difference_amount: -500,
    });
  });

  it('skips unknown events but retries and dead-letters known poison before advancing', async () => {
    const edge = await createEdge();
    const orderId = randomUUID();
    const poison = event(edge, {
      sequence: 1,
      eventType: 'ORDER_CREATED',
      aggregateId: orderId,
      payload: { orderType: 'COUNTER' },
    });
    const unknown = event(edge, {
      sequence: 2,
      eventType: 'FUTURE_EVENT',
      aggregateId: orderId,
      payload: { future: true },
    });
    await ingest([poison, unknown]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig({ maxAttempts: 2 }),
      randomUUID(),
      logger,
    );
    const firstAt = new Date('2026-08-27T13:00:00.000Z');
    expect(await worker.runOnce(firstAt)).toBe(1);
    expect(await worker.runOnce(new Date(firstAt.getTime() + 500))).toBe(0);
    expect(await worker.runOnce(new Date(firstAt.getTime() + 1_001))).toBe(1);
    expect(await worker.runOnce(new Date(firstAt.getTime() + 1_002))).toBe(1);

    const outcomes = await database.pool.query(
      `SELECT event_id, outcome FROM cloud_projection_event_receipts
       WHERE projection_name = 'operational_summaries' AND projection_version = 1
         AND event_id = ANY($1::uuid[]) ORDER BY local_sequence`,
      [[poison.eventId, unknown.eventId]],
    );
    expect(outcomes.rows).toEqual([
      { event_id: poison.eventId, outcome: 'DEAD_LETTER' },
      { event_id: unknown.eventId, outcome: 'SKIPPED_UNHANDLED' },
    ]);
    const checkpoint = await database.pool.query(
      `SELECT last_local_sequence, degraded FROM cloud_projection_checkpoints
       WHERE projection_name = 'operational_summaries' AND projection_version = 1 AND edge_id = $1`,
      [edge.edgeId],
    );
    expect(checkpoint.rows[0]).toEqual({ last_local_sequence: 2, degraded: true });
  });

  it('recovers expired leases and prevents two workers from claiming the same event', async () => {
    const edge = await createEdge();
    const unknown = event(edge, {
      sequence: 1,
      eventType: 'FUTURE_EVENT',
      aggregateId: randomUUID(),
      payload: {},
    });
    await ingest([unknown]);
    const firstAt = new Date('2026-08-27T14:00:00.000Z');
    const first = await projectionRepository.claimEvents({
      projectionVersion,
      workerId: 'worker-a',
      limit: 1,
      leaseDurationMs: 1_000,
      now: firstAt,
    });
    expect(first).toHaveLength(1);
    expect(
      await projectionRepository.claimEvents({
        projectionVersion,
        workerId: 'worker-b',
        limit: 1,
        leaseDurationMs: 1_000,
        now: firstAt,
      }),
    ).toEqual([]);
    const recovered = await projectionRepository.claimEvents({
      projectionVersion,
      workerId: 'worker-b',
      limit: 1,
      leaseDurationMs: 1_000,
      now: new Date(firstAt.getTime() + 1_001),
    });
    expect(recovered.map((item) => item.eventId)).toEqual([unknown.eventId]);
    await projectionRepository.completeEvent({
      event: recovered[0] as ClaimedCloudEvent,
      workerId: 'worker-b',
      projectionVersion,
      action: { type: 'NOOP' },
      outcome: 'SKIPPED_UNHANDLED',
      now: new Date(firstAt.getTime() + 1_002),
    });
  });

  it('claims by Edge localSequence rather than occurredAt', async () => {
    const edge = await createEdge();
    const aggregateId = randomUUID();
    const first = event(edge, {
      sequence: 1,
      eventType: 'FUTURE_EVENT',
      aggregateId,
      payload: {},
    });
    const second = {
      ...event(edge, {
        sequence: 2,
        eventType: 'FUTURE_EVENT',
        aggregateId,
        payload: {},
      }),
      occurredAt: '2026-08-27T10:00:00.000Z',
    };
    await ingest([first, second]);
    const now = new Date('2026-08-27T16:00:00.000Z');
    const firstClaim = await projectionRepository.claimEvents({
      projectionVersion,
      workerId: 'ordering-worker',
      limit: 10,
      leaseDurationMs: 1_000,
      now,
    });
    expect(firstClaim.map((item) => item.eventId)).toEqual([first.eventId]);
    await projectionRepository.completeEvent({
      event: firstClaim[0]!,
      workerId: 'ordering-worker',
      projectionVersion,
      action: { type: 'NOOP' },
      outcome: 'SKIPPED_UNHANDLED',
      now,
    });
    const secondClaim = await projectionRepository.claimEvents({
      projectionVersion,
      workerId: 'ordering-worker',
      limit: 10,
      leaseDurationMs: 1_000,
      now,
    });
    expect(secondClaim.map((item) => item.eventId)).toEqual([second.eventId]);
    await projectionRepository.completeEvent({
      event: secondClaim[0]!,
      workerId: 'ordering-worker',
      projectionVersion,
      action: { type: 'NOOP' },
      outcome: 'SKIPPED_UNHANDLED',
      now,
    });
  });

  it('does not mutate an Order summary through another Edge scope', async () => {
    const ownerEdge = await createEdge();
    const foreignEdge = await createEdge();
    const orderId = randomUUID();
    await ingest([
      event(ownerEdge, {
        sequence: 1,
        eventType: 'ORDER_CREATED',
        aggregateId: orderId,
        payload: { orderType: 'COUNTER', orderChannel: 'POS', tableIds: [] },
      }),
    ]);
    await ingest([
      event(foreignEdge, {
        sequence: 1,
        eventType: 'ITEM_ADDED',
        aggregateId: orderId,
        payload: { itemId: randomUUID(), productName: 'Foreign item', specialInstructions: null },
      }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig(),
      randomUUID(),
      logger,
    );
    expect(await worker.runOnce(new Date('2026-08-27T16:30:00.000Z'))).toBeGreaterThanOrEqual(2);
    const summary = await database.pool.query(
      `SELECT item_count FROM cloud_order_operational_summaries
       WHERE projection_version = 1 AND order_id = $1`,
      [orderId],
    );
    expect(summary.rows[0]?.item_count).toBe(0);
  });

  it('marks a closed Sale incomplete when an earlier known event became poison', async () => {
    const edge = await createEdge();
    const orderId = randomUUID();
    await ingest([
      event(edge, {
        sequence: 1,
        eventType: 'ORDER_CREATED',
        aggregateId: orderId,
        payload: { orderType: 'COUNTER', orderChannel: 'POS', tableIds: [] },
      }),
      event(edge, {
        sequence: 2,
        eventType: 'ITEM_ADDED',
        aggregateId: orderId,
        payload: {},
      }),
      event(edge, {
        sequence: 3,
        eventType: 'PAYMENT_COMPLETED',
        aggregateId: orderId,
        payload: {
          paymentId: randomUUID(),
          cashSessionId: randomUUID(),
          method: 'CARD',
          amountApplied: 3_200,
          tipAmount: 0,
          currency: 'MXN',
        },
      }),
      event(edge, {
        sequence: 4,
        eventType: 'ORDER_CLOSED',
        aggregateId: orderId,
        payload: { orderId },
      }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig({ maxAttempts: 2 }),
      randomUUID(),
      logger,
    );
    const now = new Date('2026-08-27T17:00:00.000Z');
    expect(await worker.runOnce(now)).toBeGreaterThanOrEqual(1);
    expect(await worker.runOnce(new Date(now.getTime() + 1))).toBeGreaterThanOrEqual(1);
    expect(await worker.runOnce(new Date(now.getTime() + 1_002))).toBeGreaterThanOrEqual(1);
    expect(await worker.runOnce(new Date(now.getTime() + 1_003))).toBeGreaterThanOrEqual(1);
    expect(await worker.runOnce(new Date(now.getTime() + 1_004))).toBeGreaterThanOrEqual(1);

    const sale = await database.pool.query(
      `SELECT sale_amount::int, completeness_status FROM cloud_closed_sale_summaries
       WHERE projection_version = 1 AND order_id = $1`,
      [orderId],
    );
    expect(sale.rows[0]).toEqual({ sale_amount: 3_200, completeness_status: 'INCOMPLETE' });
  });

  it('rebuilds a projection version from the immutable Inbox', async () => {
    const edge = await createEdge();
    const orderId = randomUUID();
    await ingest([
      event(edge, {
        sequence: 1,
        eventType: 'ORDER_CREATED',
        aggregateId: orderId,
        payload: { orderType: 'COUNTER', orderChannel: 'POS', tableIds: [] },
      }),
    ]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig({ projectionVersion: 2, maxAttempts: 1 }),
      randomUUID(),
      logger,
    );
    const firstReplayCount = await worker.drain();
    expect(firstReplayCount).toBeGreaterThanOrEqual(1);
    const inboxCount = await database.pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM cloud_sync_inbox',
    );
    await projectionRepository.resetProjectionVersion(2);
    expect(await projectionRepository.countUnprocessed(2)).toBe(inboxCount.rows[0]!.count);
    expect(await worker.drain()).toBeGreaterThanOrEqual(inboxCount.rows[0]!.count);

    const counts = await database.pool.query(
      `SELECT
           (SELECT count(*)::int FROM cloud_sync_inbox WHERE edge_id = $1) AS inbox_count,
           (SELECT count(*)::int FROM cloud_order_operational_summaries
            WHERE projection_version = 2 AND order_id = $2) AS projection_count`,
      [edge.edgeId, orderId],
    );
    expect(counts.rows[0]).toEqual({ inbox_count: 1, projection_count: 1 });
  }, 15_000);

  it('rolls back derived writes when a projection dependency is missing', async () => {
    const edge = await createEdge();
    const cashSessionId = randomUUID();
    const cashMovementId = randomUUID();
    const orphan = event(edge, {
      sequence: 1,
      eventType: 'CASH_MOVEMENT_CREATED',
      aggregateId: cashSessionId,
      payload: {
        cashMovementId,
        cashSessionId,
        movementType: 'CASH_IN',
        amount: { amount: 500, currency: 'MXN' },
        reason: 'Orphan movement',
        actorUserId: randomUUID(),
      },
    });
    await ingest([orphan]);
    const worker = new CloudProjectionWorker(
      projectionRepository,
      workerConfig(),
      randomUUID(),
      logger,
    );
    expect(await worker.runOnce(new Date('2026-08-27T15:00:00.000Z'))).toBeGreaterThanOrEqual(1);
    const state = await database.pool.query(
      `SELECT
         (SELECT count(*)::int FROM cloud_cash_movements WHERE cash_movement_id = $1) AS movements,
         (SELECT count(*)::int FROM cloud_projection_event_receipts WHERE event_id = $2) AS receipts`,
      [cashMovementId, orphan.eventId],
    );
    expect(state.rows[0]).toEqual({ movements: 0, receipts: 0 });
  });
});
