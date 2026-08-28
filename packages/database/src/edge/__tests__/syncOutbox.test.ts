import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createEdgeDatabase } from '../db.js';
import { prepareDevelopmentDatabase } from '../prepareDevelopmentDatabase.js';
import { eventLog } from '../schema.js';
import { SyncOutboxRepository } from '../repositories/SyncOutboxRepository.js';

const tenantId = '01991a00-0000-7000-8000-000000000301';
const locationId = '01991a00-0000-7000-8000-000000000302';
const paths: string[] = [];

function createDatabase() {
  const path = join(tmpdir(), `comanview-sync-outbox-${Date.now()}-${Math.random()}.db`);
  paths.push(path);
  prepareDevelopmentDatabase(path);
  return { path, ...createEdgeDatabase(path) };
}

afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }
});

describe('durable Edge sync outbox', () => {
  it('persists immutable Edge identity across restart', () => {
    const first = createDatabase();
    const identity = new SyncOutboxRepository(first.db).ensureIdentity({
      configuredEdgeId: null,
      tenantId,
      locationId,
    });
    first.close();

    const reopened = createEdgeDatabase(first.path);
    const repository = new SyncOutboxRepository(reopened.db);
    expect(repository.ensureIdentity({ configuredEdgeId: null, tenantId, locationId })).toEqual(
      identity,
    );
    expect(() =>
      repository.ensureIdentity({
        configuredEdgeId: '01991a00-0000-7000-8000-000000000999',
        tenantId,
        locationId,
      }),
    ).toThrow(/cannot replace/);
    reopened.close();
  });

  it('claims in stable order, recovers an expired lease, and preserves synced history', () => {
    const database = createDatabase();
    const repository = new SyncOutboxRepository(database.db);
    repository.ensureIdentity({ configuredEdgeId: null, tenantId, locationId });
    const now = new Date('2026-08-27T12:00:00.000Z');
    database.db
      .insert(eventLog)
      .values({
        id: '01991a00-0000-7000-8000-000000000911',
        eventType: 'ORDER_CREATED',
        aggregateType: 'ORDER',
        aggregateId: '01991a00-0000-7000-8000-000000000912',
        version: 1,
        payload: JSON.stringify({ orderId: '01991a00-0000-7000-8000-000000000912' }),
        occurredAt: now,
      })
      .run();

    const firstClaim = repository.claimBatch(10, 1_000, now);
    expect(firstClaim.map((event) => event.id)).toEqual(['01991a00-0000-7000-8000-000000000911']);
    database.close();

    const reopened = createEdgeDatabase(database.path);
    const recoveredRepository = new SyncOutboxRepository(reopened.db);
    expect(recoveredRepository.claimBatch(10, 1_000, new Date(now.getTime() + 500))).toEqual([]);
    expect(recoveredRepository.claimBatch(10, 1_000, new Date(now.getTime() + 1_001))).toHaveLength(
      1,
    );

    recoveredRepository.markSynced([firstClaim[0]!.id], new Date(now.getTime() + 2_000));
    const row = reopened.db.select().from(eventLog).where(eq(eventLog.id, firstClaim[0]!.id)).get();
    expect(row?.syncStatus).toBe('SYNCED');
    expect(row?.attemptCount).toBe(2);
    expect(row?.syncedAt).toEqual(new Date(now.getTime() + 2_000));
    expect(recoveredRepository.claimBatch(10, 1_000, new Date(now.getTime() + 3_000))).toEqual([]);
    reopened.close();
  });

  it('uses localSequence as authority even when occurredAt moves backwards', () => {
    const database = createDatabase();
    const repository = new SyncOutboxRepository(database.db);
    repository.ensureIdentity({ configuredEdgeId: null, tenantId, locationId });
    database.db
      .insert(eventLog)
      .values([
        {
          id: '01991a00-0000-7000-8000-000000000921',
          eventType: 'ORDER_CREATED',
          aggregateType: 'ORDER',
          aggregateId: '01991a00-0000-7000-8000-000000000923',
          version: 1,
          payload: '{}',
          occurredAt: new Date('2026-08-27T12:00:10.000Z'),
        },
        {
          id: '01991a00-0000-7000-8000-000000000922',
          eventType: 'ITEM_ADDED',
          aggregateType: 'ORDER',
          aggregateId: '01991a00-0000-7000-8000-000000000923',
          version: 2,
          payload: '{}',
          occurredAt: new Date('2026-08-27T11:59:00.000Z'),
        },
      ])
      .run();

    const claimed = repository.claimBatch(10, 1_000, new Date('2026-08-27T12:01:00.000Z'));
    expect(claimed.map((event) => event.id)).toEqual([
      '01991a00-0000-7000-8000-000000000921',
      '01991a00-0000-7000-8000-000000000922',
    ]);
    database.close();
  });

  it('blocks later events behind a transient failure but advances after a permanent failure', () => {
    const database = createDatabase();
    const repository = new SyncOutboxRepository(database.db);
    repository.ensureIdentity({ configuredEdgeId: null, tenantId, locationId });
    const now = new Date('2026-08-27T12:00:00.000Z');
    database.db
      .insert(eventLog)
      .values([
        {
          id: '01991a00-0000-7000-8000-000000000924',
          eventType: 'ORDER_CREATED',
          aggregateType: 'ORDER',
          aggregateId: '01991a00-0000-7000-8000-000000000926',
          version: 1,
          payload: '{}',
          occurredAt: now,
        },
        {
          id: '01991a00-0000-7000-8000-000000000925',
          eventType: 'ITEM_ADDED',
          aggregateType: 'ORDER',
          aggregateId: '01991a00-0000-7000-8000-000000000926',
          version: 2,
          payload: '{}',
          occurredAt: now,
        },
      ])
      .run();

    const first = repository.claimBatch(1, 1_000, now)[0]!;
    repository.markFailed(first.id, 'temporary', new Date(now.getTime() + 5_000));
    expect(repository.claimBatch(10, 1_000, new Date(now.getTime() + 1_000))).toEqual([]);

    const retry = repository.claimBatch(1, 1_000, new Date(now.getTime() + 5_001))[0]!;
    repository.markFailed(retry.id, 'permanent', null);
    expect(
      repository.claimBatch(10, 1_000, new Date(now.getTime() + 5_002)).map((event) => event.id),
    ).toEqual(['01991a00-0000-7000-8000-000000000925']);
    database.close();
  });
});
