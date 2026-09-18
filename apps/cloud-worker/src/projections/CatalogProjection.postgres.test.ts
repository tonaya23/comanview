import { randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  createCloudDatabase,
  migrateCloudDatabase,
  CloudSyncRepository,
  CloudProjectionRepository,
} from '@comanview/database';
import { canonicalCatalogJson, type CatalogProjectedEntity } from '@comanview/contracts';
import type { SyncEventEnvelope } from '@comanview/sync';
import { CloudProjectionWorker } from './CloudProjectionWorker.js';
const url = process.env['COMANVIEW_TEST_POSTGRES_URL'];
describe.skipIf(!url)('B1d real PostgreSQL catalog projection', () => {
  const databaseName = `catalog_b1d_${randomUUID().replaceAll('-', '')}`;
  const isolatedUrl = new URL(url ?? 'postgresql://localhost/unused');
  isolatedUrl.pathname = `/${databaseName}`;
  const admin = createCloudDatabase(url!),
    database = createCloudDatabase(isolatedUrl.toString()),
    sync = new CloudSyncRepository(database.db),
    repo = new CloudProjectionRepository(database.pool),
    edges: string[] = [];
  const worker = new CloudProjectionWorker(
    repo,
    {
      databaseUrl: url!,
      projectionVersion: 91,
      pollIntervalMs: 100,
      leaseDurationMs: 1000,
      batchSize: 100,
      maxAttempts: 1,
    },
    randomUUID(),
    { info() {}, warn() {}, error() {} },
  );
  beforeAll(async () => {
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    await migrateCloudDatabase(isolatedUrl.toString());
  });
  afterAll(async () => {
    for (const edge of edges) {
      const b = (
        await database.pool.query('SELECT tenant_id,location_id FROM edges WHERE edge_id=$1', [
          edge,
        ])
      ).rows[0];
      for (const table of [
        'cloud_catalog_chunks',
        'cloud_catalog_baselines',
        'cloud_catalog_deltas',
        'cloud_catalog_entities',
        'cloud_catalog_checkpoint',
        'cloud_projection_event_receipts',
        'cloud_projection_checkpoints',
        'cloud_sync_inbox',
        'edge_credentials',
        'edge_heartbeats',
      ])
        await database.pool.query(`DELETE FROM ${table} WHERE edge_id=$1`, [edge]);
      await database.pool.query('DELETE FROM edges WHERE edge_id=$1', [edge]);
      if (b) {
        await database.pool.query('DELETE FROM cloud_locations WHERE location_id=$1', [
          b.location_id,
        ]);
        await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1', [b.tenant_id]);
      }
    }
    await database.close();
    if (!/^catalog_b1d_[a-f0-9]{32}$/.test(databaseName))
      throw new Error('Invalid isolated database name');
    await admin.pool.query(`DROP DATABASE "${databaseName}"`);
    await admin.close();
  });
  async function fixture() {
    const binding = { edgeId: randomUUID(), tenantId: randomUUID(), locationId: randomUUID() };
    edges.push(binding.edgeId);
    await sync.provisionEdge({ ...binding, credentialHash: 'isolated-catalog-test' });
    let sequence = 0;
    const entity: CatalogProjectedEntity = {
      entityType: 'CATEGORY',
      state: {
        id: randomUUID(),
        name: 'Legacy',
        active: true,
        displayOrder: 0,
        systemKey: null,
        version: 1,
      },
    };
    const product: CatalogProjectedEntity = {
      entityType: 'PRODUCT',
      state: {
        id: randomUUID(),
        name: 'Legacy meal',
        description: '',
        productType: 'STANDARD',
        categoryId: entity.state.id,
        sku: '001',
        barcode: null,
        basePrice: { amount: 9007199254740000, currency: 'MXN' },
        active: true,
        available: true,
        taxProfileId: randomUUID(),
        taxProfileRevision: 1,
        stationId: null,
        displayOrder: 0,
        version: 1,
      },
    };
    const event = (
      eventType: string,
      payload: Record<string, unknown>,
      epoch = 0,
    ): SyncEventEnvelope => ({
      schemaVersion: 1,
      eventId: randomUUID(),
      eventType,
      aggregateType: 'CATALOG',
      aggregateId: String(payload['entityId'] ?? binding.edgeId),
      aggregateVersion: Number(payload['entityVersion'] ?? 1),
      ...binding,
      occurredAt: new Date().toISOString(),
      localSequence: ++sequence,
      recoveryEpoch: epoch,
      payload,
    });
    const baseline = (
      generation = 20,
      epoch = 0,
      entities: CatalogProjectedEntity[] = [entity, product],
    ) => {
      const digest = createHash('sha256').update(canonicalCatalogJson(entities)).digest('hex'),
        baselineId = createHash('sha256')
          .update(
            canonicalCatalogJson({
              ...binding,
              recoveryEpoch: epoch,
              catalogGeneration: generation,
              capabilityVersion: 1,
              digest,
            }),
          )
          .digest('hex');
      const manifest = {
        payloadVersion: 1,
        ...binding,
        sourceEpoch: epoch,
        baselineId,
        catalogGeneration: generation,
        chunkCount: entities.length || 1,
        entityCount: entities.length,
        digest,
      };
      return [
        event('CATALOG_BASELINE_STARTED', { ...manifest, phase: 'STARTED' }, epoch),
        ...(entities.length ? entities.map((e) => [e]) : [[]]).map((chunk, chunkIndex) =>
          event(
            'CATALOG_BASELINE_CHUNK',
            { ...manifest, phase: 'CHUNK', chunkIndex, entities: chunk },
            epoch,
          ),
        ),
        event('CATALOG_BASELINE_COMPLETED', { ...manifest, phase: 'COMPLETED' }, epoch),
      ];
    };
    const delta = (generation: number, name = 'Updated', epoch = 0) =>
      event(
        'CATALOG_CATEGORY_UPDATED',
        {
          payloadVersion: 1,
          ...binding,
          entityId: entity.state.id,
          entityVersion: 2,
          catalogGeneration: generation,
          commandId: randomUUID(),
          entities: [{ ...entity, state: { ...entity.state, name, version: 2 } }],
        },
        epoch,
      );
    const ingest = async (events: SyncEventEnvelope[]) => {
      const r = await sync.ingestBatch(randomUUID(), '1', events);
      expect(r.integrityRejected).toEqual([]);
      for (let i = 0; i < events.length + 2; i++) await worker.runOnce();
    };
    return {
      binding,
      entity,
      product,
      event,
      baseline,
      delta,
      ingest,
      read: () => repo.readCatalog(91, binding),
    };
  }
  it('publishes complete legacy baseline, exact money, duplicate chunks and Inbox dedup', async () => {
    const f = await fixture(),
      b = f.baseline();
    await f.ingest(b.slice(0, 3));
    expect(await f.read()).toBeNull();
    await f.ingest([b[1]!, b[3]!]);
    const result = await f.read();
    expect(result.generation).toBe('20');
    expect(result.entities).toHaveLength(2);
    expect(
      result.entities.find((e: CatalogProjectedEntity) => e.entityType === 'PRODUCT').state
        .basePrice.amount,
    ).toBe(9007199254740000);
    await f.ingest([f.event('CATALOG_BASELINE_CHUNK', b[1]!.payload)]);
    expect(await f.read()).toEqual(result);
  });
  it('missing chunk/completion never publishes and late chunk completes deterministically', async () => {
    const f = await fixture(),
      b = f.baseline();
    await f.ingest([b[0]!, b[2]!, b[3]!]);
    expect(await f.read()).toBeNull();
    await f.ingest([b[1]!]);
    expect((await f.read()).entities).toHaveLength(2);
  });
  it('bad digest fails closed without exposing partial baseline', async () => {
    const f = await fixture(),
      b = f.baseline();
    for (const e of b) e.payload['digest'] = '0'.repeat(64);
    await f.ingest(b);
    expect(await f.read()).toBeNull();
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM cloud_projection_event_receipts WHERE edge_id=$1 AND outcome='DEAD_LETTER'",
          [f.binding.edgeId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('incremental arriving during baseline is retained and cannot be overwritten by completion', async () => {
    const f = await fixture(),
      b = f.baseline(),
      d = f.delta(21);
    await f.ingest([b[0]!, d]);
    expect(await f.read()).toBeNull();
    await f.ingest(b.slice(1));
    const result = await f.read();
    expect(result.generation).toBe('21');
    expect(
      result.entities.find((e: CatalogProjectedEntity) => e.entityType === 'CATEGORY').state.name,
    ).toBe('Updated');
  });
  it('buffers generation gaps and deduplicates logical incremental events', async () => {
    const f = await fixture();
    await f.ingest(f.baseline());
    const d21 = f.delta(21, 'First'),
      d22 = f.delta(22, 'Second');
    await f.ingest([d22]);
    expect((await f.read()).generation).toBe('20');
    await f.ingest([d21]);
    const expected = await f.read();
    expect(expected.generation).toBe('22');
    await f.ingest([f.event(d22.eventType, d22.payload)]);
    expect(await f.read()).toEqual(expected);
  });
  it('new epoch hides previous current projection until complete baseline; old epoch cannot overwrite it', async () => {
    const f = await fixture();
    await f.ingest(f.baseline(100));
    const b = f.baseline(3, 1);
    await f.ingest([b[0]!]);
    expect(await f.read()).toBeNull();
    await f.ingest(b.slice(1));
    await f.ingest([f.delta(101, 'Old', 0)]);
    expect((await f.read()).generation).toBe('3');
    expect((await f.read()).recovery_epoch).toBe('1');
    await f.ingest([f.delta(4, 'Recovered', 1)]);
    expect((await f.read()).generation).toBe('4');
  });
  it('replay rebuild produces identical read-only state and binding denies unrelated reads', async () => {
    const f = await fixture();
    await f.ingest([...f.baseline(), f.delta(21)]);
    const before = await f.read();
    await repo.resetProjectionVersion(91);
    for (let i = 0; i < 100 && (await repo.countUnprocessed(91)); i++) await worker.runOnce();
    expect(await repo.countUnprocessed(91)).toBe(0);
    expect(await f.read()).toEqual(before);
    expect(await repo.readCatalog(91, { ...f.binding, tenantId: randomUUID() })).toBeNull();
  });
  it('restored pending baseline re-enveloped in another epoch is not a new baseline', async () => {
    const f = await fixture(),
      old = f.baseline();
    for (const e of old) e.recoveryEpoch = 1;
    await f.ingest(old);
    expect(await f.read()).toBeNull();
    await f.ingest(f.baseline(20, 1));
    expect((await f.read()).recovery_epoch).toBe('1');
  });
  it('an empty source publishes a complete empty baseline rather than an incomplete capture', async () => {
    const f = await fixture();
    await f.ingest(f.baseline(0, 0, []));
    expect((await f.read()).entities).toEqual([]);
    expect((await f.read()).generation).toBe('0');
  });
  it('conflicting duplicate chunk cannot alter an already published baseline', async () => {
    const f = await fixture(),
      b = f.baseline();
    await f.ingest(b);
    const before = await f.read();
    await f.ingest([f.event('CATALOG_BASELINE_CHUNK', { ...b[1]!.payload, entities: [] })]);
    expect(await f.read()).toEqual(before);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM cloud_projection_event_receipts WHERE edge_id=$1 AND outcome='DEAD_LETTER'",
          [f.binding.edgeId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
