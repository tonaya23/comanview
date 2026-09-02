import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SyncEventEnvelope } from '@comanview/sync';
import { createCloudDatabase } from '../db.js';
import { migrateCloudDatabase } from '../migrate.js';
import {
  CloudSyncRepository,
  CloudSyncSequenceConflictError,
} from '../repositories/CloudSyncRepository.js';

const databaseUrl = process.env['COMANVIEW_TEST_POSTGRES_URL'];
const edgeId = '01991a00-0000-7000-8000-000000000941';
const tenantId = '01991a00-0000-7000-8000-000000000942';
const locationId = '01991a00-0000-7000-8000-000000000943';
const eventId = '01991a00-0000-7000-8000-000000000944';

describe.skipIf(!databaseUrl)('Cloud PostgreSQL Inbox integration', () => {
  const database = createCloudDatabase(databaseUrl!);
  const repository = new CloudSyncRepository(database.db);

  beforeAll(async () => {
    await migrateCloudDatabase(databaseUrl!);
    await database.pool.query('DELETE FROM edge_heartbeats WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM cloud_sync_inbox WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edge_credentials WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edges WHERE edge_id = $1', [edgeId]);
    await repository.provisionEdge({ edgeId, tenantId, locationId, credentialHash: 'test-hash' });
  });

  afterAll(async () => {
    await database.pool.query('DELETE FROM edge_heartbeats WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM cloud_sync_inbox WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edge_credentials WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM edges WHERE edge_id = $1', [edgeId]);
    await database.pool.query('DELETE FROM cloud_locations WHERE location_id = $1', [locationId]);
    await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id = $1', [tenantId]);
    await database.close();
  });

  it('enforces durable eventId idempotency across batches and stores heartbeat', async () => {
    const event: SyncEventEnvelope = {
      schemaVersion: 1,
      eventId,
      eventType: 'ORDER_CREATED',
      aggregateType: 'ORDER',
      aggregateId: '01991a00-0000-7000-8000-000000000945',
      tenantId,
      locationId,
      edgeId,
      occurredAt: '2026-08-27T12:00:00.000Z',
      localSequence: 1,
      recoveryEpoch: 0,
      aggregateVersion: 1,
      payload: { orderId: '01991a00-0000-7000-8000-000000000945' },
    };
    const first = await repository.ingestBatch('01991a00-0000-7000-8000-000000000946', '1', [
      event,
    ]);
    const retry = await repository.ingestBatch('01991a00-0000-7000-8000-000000000947', '1', [
      event,
    ]);
    expect(first).toEqual({ accepted: [eventId], duplicates: [], integrityRejected: [] });
    expect(retry).toEqual({ accepted: [], duplicates: [eventId], integrityRejected: [] });
    const conflicting = await repository.ingestBatch('01991a00-0000-7000-8000-000000000948', '1', [
      { ...event, eventId: '01991a00-0000-7000-8000-000000000949' },
    ]);
    expect(conflicting).toEqual({
      accepted: [],
      duplicates: [],
      integrityRejected: [
        {
          eventId: '01991a00-0000-7000-8000-000000000949',
          code: 'SYNC_LOCAL_SEQUENCE_CONFLICT',
          message: 'Edge local sequence is already bound to a different event.',
        },
      ],
    });
    const recoveredEpoch=await repository.ingestBatch('01991a00-0000-7000-8000-000000000950','1',[{
      ...event,eventId:'01991a00-0000-7000-8000-000000000950',recoveryEpoch:1,
    }]);
    expect(recoveredEpoch.accepted).toEqual(['01991a00-0000-7000-8000-000000000950']);
    expect(await repository.countInboxEvents()).toBeGreaterThanOrEqual(1);

    await repository.saveHeartbeat({
      edgeId,
      tenantId,
      locationId,
      edgeVersion: 'test',
      schemaVersion: '10',
      pendingEventCount: 0,
      status: 'ONLINE',
      reportedAt: new Date('2026-08-27T12:00:00.000Z'),
      receivedAt: new Date('2026-08-27T12:00:01.000Z'),
    });
    const heartbeat = await database.pool.query(
      'SELECT last_seen_at, pending_event_count FROM edge_heartbeats WHERE edge_id = $1',
      [edgeId],
    );
    expect(heartbeat.rows[0]?.pending_event_count).toBe(0);
  });

  it('turns a concurrent localSequence collision into an explicit Sync integrity error', async () => {
    const base: SyncEventEnvelope = {
      schemaVersion: 1,
      eventId: '01991a00-0000-7000-8000-000000000951',
      eventType: 'ORDER_CREATED',
      aggregateType: 'ORDER',
      aggregateId: '01991a00-0000-7000-8000-000000000953',
      tenantId,
      locationId,
      edgeId,
      occurredAt: '2026-08-27T12:01:00.000Z',
      localSequence: 2,
      recoveryEpoch: 0,
      aggregateVersion: 1,
      payload: { orderId: '01991a00-0000-7000-8000-000000000953' },
    };
    const results = await Promise.allSettled([
      repository.ingestBatch('01991a00-0000-7000-8000-000000000954', '1', [base]),
      repository.ingestBatch('01991a00-0000-7000-8000-000000000955', '1', [
        { ...base, eventId: '01991a00-0000-7000-8000-000000000952' },
      ]),
    ]);
    const accepted = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.accepted : [],
    );
    const integrityRejected = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.integrityRejected : [],
    );
    const conflictErrors = results.filter(
      (result) =>
        result.status === 'rejected' && result.reason instanceof CloudSyncSequenceConflictError,
    );
    expect(accepted).toHaveLength(1);
    expect(integrityRejected.length + conflictErrors.length).toBe(1);
    expect(integrityRejected[0]?.code ?? 'SYNC_LOCAL_SEQUENCE_CONFLICT').toBe(
      'SYNC_LOCAL_SEQUENCE_CONFLICT',
    );
  });
});
