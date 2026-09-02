import { afterEach, describe, expect, it } from 'vitest';
import type { CloudEdgeRecord } from '@comanview/database';
import { SYNC_PROTOCOL_VERSION, type SyncEventEnvelope } from '@comanview/sync';
import { buildCloudApp, type CloudRepository } from '../index.js';
import { hashEdgeToken } from '../auth/EdgeAuthenticator.js';

const edgeId = '01991a00-0000-7000-8000-000000000931';
const tenantId = '01991a00-0000-7000-8000-000000000301';
const locationId = '01991a00-0000-7000-8000-000000000302';
const token = 'development-test-edge-token';

const edge: CloudEdgeRecord = {
  edgeId,
  tenantId,
  locationId,
  credentialHash: hashEdgeToken(token),
  status: 'ACTIVE',
};

function event(eventId = '01991a00-0000-7000-8000-000000000932'): SyncEventEnvelope {
  return {
    schemaVersion: 1,
    eventId,
    eventType: 'ORDER_CREATED',
    aggregateType: 'ORDER',
    aggregateId: '01991a00-0000-7000-8000-000000000933',
    tenantId,
    locationId,
    edgeId,
    occurredAt: '2026-08-27T12:00:00.000Z',
    localSequence: 1,
    recoveryEpoch: 0,
    aggregateVersion: 1,
    payload: { orderId: '01991a00-0000-7000-8000-000000000933' },
  };
}

class MemoryCloudRepository implements CloudRepository {
  readonly events = new Set<string>();
  readonly sequences = new Map<number, string>();
  heartbeat: Parameters<CloudRepository['saveHeartbeat']>[0] | null = null;

  async getEdge(requestedEdgeId: string): Promise<CloudEdgeRecord | null> {
    return requestedEdgeId === edgeId ? edge : null;
  }

  async ingestBatch(_batchId: string, _protocolVersion: string, events: SyncEventEnvelope[]) {
    const accepted: string[] = [];
    const duplicates: string[] = [];
    const integrityRejected: Array<{
      eventId: string;
      code: 'SYNC_LOCAL_SEQUENCE_CONFLICT';
      message: string;
    }> = [];
    for (const item of events) {
      if (this.events.has(item.eventId)) duplicates.push(item.eventId);
      else if (this.sequences.has(item.localSequence)) {
        integrityRejected.push({
          eventId: item.eventId,
          code: 'SYNC_LOCAL_SEQUENCE_CONFLICT',
          message: 'Edge local sequence is already bound to a different event.',
        });
      } else {
        this.events.add(item.eventId);
        this.sequences.set(item.localSequence, item.eventId);
        accepted.push(item.eventId);
      }
    }
    return { accepted, duplicates, integrityRejected };
  }

  async saveHeartbeat(input: Parameters<CloudRepository['saveHeartbeat']>[0]): Promise<void> {
    this.heartbeat = input;
  }

  async countInboxEvents(): Promise<number> {
    return this.events.size;
  }
}

const apps: ReturnType<typeof buildCloudApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(maxBatchSize = 100) {
  const repository = new MemoryCloudRepository();
  const app = buildCloudApp({ repository, maxBatchSize });
  apps.push(app);
  const headers = { authorization: `Bearer ${token}`, 'x-comanview-edge-id': edgeId };
  return { app, repository, headers };
}

function batch(events: unknown[], batchId = '01991a00-0000-7000-8000-000000000934') {
  return { protocolVersion: SYNC_PROTOCOL_VERSION, edgeId, tenantId, locationId, batchId, events };
}

describe('Cloud sync ingestion', () => {
  it('persists an event once and returns duplicate across a different batch', async () => {
    const { app, repository, headers } = setup();
    const first = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([event()]),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accepted: [event().eventId], duplicates: [] });

    const second = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([event()], '01991a00-0000-7000-8000-000000000935'),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ accepted: [], duplicates: [event().eventId] });
    expect(await repository.countInboxEvents()).toBe(1);
  });

  it('returns a per-event rejection without discarding valid events', async () => {
    const { app, headers } = setup();
    const invalid = { ...event('01991a00-0000-7000-8000-000000000936'), occurredAt: 'invalid' };
    const response = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([event(), invalid]),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: [event().eventId],
      rejected: [{ eventId: invalid.eventId, code: 'SYNC_EVENT_INVALID' }],
    });
  });

  it('reports an Edge localSequence collision as an explicit integrity rejection', async () => {
    const { app, headers } = setup();
    const first = event();
    const conflicting = event('01991a00-0000-7000-8000-000000000938');
    await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([first]),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([conflicting], '01991a00-0000-7000-8000-000000000939'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: [],
      duplicates: [],
      rejected: [{ eventId: conflicting.eventId, code: 'SYNC_LOCAL_SEQUENCE_CONFLICT' }],
    });
  });

  it('rejects invalid credentials and Tenant/Location spoofing', async () => {
    const { app, headers } = setup();
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers: { ...headers, authorization: 'Bearer incorrect-token' },
      payload: batch([event()]),
    });
    expect(unauthorized.statusCode).toBe(401);

    const spoofedLocation = '01991a00-0000-7000-8000-000000000399';
    const forbidden = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: {
        ...batch([{ ...event(), locationId: spoofedLocation }]),
        locationId: spoofedLocation,
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toBe('EDGE_SCOPE_MISMATCH');
  });

  it('enforces the configured batch limit', async () => {
    const { app, headers } = setup(1);
    const response = await app.inject({
      method: 'POST',
      url: '/sync/v1/events',
      headers,
      payload: batch([event(), event('01991a00-0000-7000-8000-000000000937')]),
    });
    expect(response.statusCode).toBe(413);
  });

  it('persists heartbeat metadata for the authenticated Edge', async () => {
    const { app, repository, headers } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/sync/v1/heartbeat',
      headers,
      payload: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        edgeId,
        tenantId,
        locationId,
        edgeVersion: '0.0.0-test',
        schemaVersion: '10',
        timestamp: '2026-08-27T12:00:00.000Z',
        status: 'ONLINE',
        pendingEventCount: 3,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.heartbeat).toMatchObject({
      edgeId,
      tenantId,
      locationId,
      pendingEventCount: 3,
    });
  });
});
