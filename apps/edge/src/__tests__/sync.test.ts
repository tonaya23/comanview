import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SyncOutboxRepository,
  createEdgeDatabase,
  prepareDevelopmentDatabase,
} from '@comanview/database';
import { eventLog } from '@comanview/database/edge';
import type { EdgeSyncConfig } from '@comanview/config';
import {
  SYNC_PROTOCOL_VERSION,
  type EdgeHeartbeat,
  type HeartbeatAck,
  type SyncBatchAck,
  type SyncBatchRequest,
} from '@comanview/sync';
import { buildApp } from '../index.js';
import {
  CloudTransportError,
  type CloudSyncTransport,
} from '../modules/sync/HttpCloudSyncTransport.js';
import { SyncWorker } from '../modules/sync/SyncWorker.js';

const tenantId = '01991a00-0000-7000-8000-000000000301';
const locationId = '01991a00-0000-7000-8000-000000000302';
const paths: string[] = [];
const logger = { info: () => undefined, warn: () => undefined };
const config: EdgeSyncConfig = {
  enabled: true,
  cloudUrl: 'http://127.0.0.1:4000',
  token: 'not-used-by-fake-transport',
  configuredEdgeId: null,
  batchSize: 50,
  pollIntervalMs: 5_000,
  requestTimeoutMs: 1_000,
  leaseDurationMs: 1_000,
  heartbeatIntervalMs: 30_000,
  edgeVersion: 'test',
  schemaVersion: '10',
};

class FakeTransport implements CloudSyncTransport {
  batches: SyncBatchRequest[] = [];
  heartbeats: EdgeHeartbeat[] = [];
  constructor(private readonly respond: (batch: SyncBatchRequest) => Promise<SyncBatchAck>) {}
  async sendBatch(batch: SyncBatchRequest): Promise<SyncBatchAck> {
    this.batches.push(batch);
    return this.respond(batch);
  }
  async sendHeartbeat(heartbeat: EdgeHeartbeat): Promise<HeartbeatAck> {
    this.heartbeats.push(heartbeat);
    return { edgeId: heartbeat.edgeId, receivedAt: new Date().toISOString() };
  }
}

function setup() {
  const path = join(tmpdir(), `comanview-edge-sync-${Date.now()}-${Math.random()}.db`);
  paths.push(path);
  prepareDevelopmentDatabase(path);
  const database = createEdgeDatabase(path);
  const repository = new SyncOutboxRepository(database.db);
  repository.ensureIdentity({ configuredEdgeId: null, tenantId, locationId });
  const eventId = '01991a00-0000-7000-8000-000000000921';
  database.db
    .insert(eventLog)
    .values({
      id: eventId,
      eventType: 'ORDER_CREATED',
      aggregateType: 'ORDER',
      aggregateId: '01991a00-0000-7000-8000-000000000922',
      version: 1,
      payload: JSON.stringify({ orderId: '01991a00-0000-7000-8000-000000000922' }),
      occurredAt: new Date('2026-08-27T12:00:00.000Z'),
    })
    .run();
  return { path, database, repository, eventId };
}

afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }
});

describe('Edge Sync Worker', () => {
  it.each(['accepted', 'duplicates'] as const)('marks an %s ACK as SYNCED', async (kind) => {
    const context = setup();
    const transport = new FakeTransport(async (batch) => ({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: batch.batchId,
      accepted: kind === 'accepted' ? [context.eventId] : [],
      duplicates: kind === 'duplicates' ? [context.eventId] : [],
      rejected: [],
    }));
    await new SyncWorker(context.repository, transport, config, logger).runOnce(
      new Date('2026-08-27T12:01:00.000Z'),
    );
    expect(context.repository.getEventStatus(context.eventId)).toBe('SYNCED');
    expect(transport.batches[0]?.events[0]).toMatchObject({
      eventId: context.eventId,
      tenantId,
      locationId,
      aggregateType: 'ORDER',
    });
    context.database.close();
  });

  it('keeps a rejected event FAILED without retrying it aggressively', async () => {
    const context = setup();
    const transport = new FakeTransport(async (batch) => ({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: batch.batchId,
      accepted: [],
      duplicates: [],
      rejected: [{ eventId: context.eventId, code: 'INVALID', message: 'Invalid payload.' }],
    }));
    const worker = new SyncWorker(context.repository, transport, config, logger);
    await worker.runOnce(new Date('2026-08-27T12:01:00.000Z'));
    await worker.runOnce(new Date('2026-08-28T12:01:00.000Z'));
    expect(context.repository.getEventStatus(context.eventId)).toBe('FAILED');
    expect(transport.batches).toHaveLength(1);
    context.database.close();
  });

  it('retries after a lost response and accepts a later duplicate ACK', async () => {
    const context = setup();
    let attempt = 0;
    const transport = new FakeTransport(async (batch) => {
      attempt += 1;
      if (attempt === 1)
        throw new CloudTransportError(null, 'Connection dropped after persistence.');
      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        batchId: batch.batchId,
        accepted: [],
        duplicates: [context.eventId],
        rejected: [],
      };
    });
    const worker = new SyncWorker(context.repository, transport, config, logger);
    await worker.runOnce(new Date('2026-08-27T12:01:00.000Z'));
    expect(context.repository.getEventStatus(context.eventId)).toBe('FAILED');
    await worker.runOnce(new Date('2026-08-27T12:10:00.000Z'));
    expect(context.repository.getEventStatus(context.eventId)).toBe('SYNCED');
    expect(transport.batches).toHaveLength(2);
    context.database.close();
  });

  it('leaves local Edge usable and quiet when sync is disabled', async () => {
    const path = join(tmpdir(), `comanview-sync-disabled-${Date.now()}.db`);
    paths.push(path);
    prepareDevelopmentDatabase(path);
    const app = await buildApp(path, {
      authMode: 'test-bypass',
      startPrintWorker: false,
      syncConfig: { ...config, enabled: false, cloudUrl: null, token: null },
    });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/sync/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: false, cloudReachable: null });
    expect((await app.inject({ method: 'GET', url: '/catalog/products' })).statusCode).toBe(200);
    await app.close();
  });

  it('confirms local operations while configured Cloud is offline', async () => {
    const path = join(tmpdir(), `comanview-sync-cloud-offline-${Date.now()}.db`);
    paths.push(path);
    prepareDevelopmentDatabase(path);
    const offlineTransport: CloudSyncTransport = {
      sendBatch: async () => {
        throw new CloudTransportError(null, 'ECONNREFUSED');
      },
      sendHeartbeat: async () => {
        throw new CloudTransportError(null, 'ECONNREFUSED');
      },
    };
    const app = await buildApp(path, {
      authMode: 'test-bypass',
      startPrintWorker: false,
      syncTransport: offlineTransport,
      syncConfig: { ...config, pollIntervalMs: 10 },
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    expect(created.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const status = await app.inject({ method: 'GET', url: '/sync/status' });
    expect(status.json()).toMatchObject({
      enabled: true,
      cloudReachable: false,
      pendingCount: 1,
      failedCount: 1,
    });
    await app.close();
  });
});
