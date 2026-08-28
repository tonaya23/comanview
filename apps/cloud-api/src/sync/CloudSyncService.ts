import {
  EdgeHeartbeatSchema,
  SYNC_PROTOCOL_VERSION,
  SyncEventEnvelopeSchema,
  type EdgeHeartbeat,
  type SyncBatchAck,
  type SyncEventEnvelope,
} from '@comanview/sync';
import { z } from 'zod';
import {
  CloudSyncSequenceConflictError,
  type CloudEdgeRecord,
  type SyncIntegrityRejection,
} from '@comanview/database';
import { CloudError } from '../app/CloudError.js';

export interface CloudSyncPersistence {
  ingestBatch(
    batchId: string,
    protocolVersion: string,
    events: SyncEventEnvelope[],
  ): Promise<{
    accepted: string[];
    duplicates: string[];
    integrityRejected: SyncIntegrityRejection[];
  }>;
  saveHeartbeat(input: {
    edgeId: string;
    tenantId: string;
    locationId: string;
    edgeVersion: string;
    schemaVersion: string;
    pendingEventCount: number;
    status: string;
    reportedAt: Date;
    receivedAt: Date;
  }): Promise<void>;
}

export interface RawSyncBatch {
  protocolVersion: string;
  edgeId: string;
  tenantId: string;
  locationId: string;
  batchId: string;
  events: unknown[];
}

export class CloudSyncService {
  constructor(private readonly repository: CloudSyncPersistence) {}

  async ingest(edge: CloudEdgeRecord, batch: RawSyncBatch): Promise<SyncBatchAck> {
    this.assertBinding(edge, batch);
    if (batch.protocolVersion !== SYNC_PROTOCOL_VERSION) {
      throw new CloudError(
        'SYNC_PROTOCOL_UNSUPPORTED',
        422,
        'Sync protocol version is unsupported.',
      );
    }
    const acceptedForPersistence: SyncEventEnvelope[] = [];
    const rejected: SyncBatchAck['rejected'] = [];
    const seen = new Set<string>();
    for (const rawEvent of batch.events) {
      const parsed = SyncEventEnvelopeSchema.safeParse(rawEvent);
      if (!parsed.success) {
        const possibleId =
          rawEvent && typeof rawEvent === 'object' && 'eventId' in rawEvent
            ? (rawEvent as { eventId?: unknown }).eventId
            : null;
        const possibleEventId = z.string().uuid().safeParse(possibleId);
        if (!possibleEventId.success) {
          throw new CloudError(
            'SYNC_EVENT_ID_INVALID',
            422,
            'An invalid event without a usable eventId cannot be acknowledged.',
          );
        }
        rejected.push({
          eventId: possibleEventId.data,
          code: 'SYNC_EVENT_INVALID',
          message: parsed.error.issues[0]?.message ?? 'Invalid event envelope.',
        });
        continue;
      }
      const event = parsed.data;
      this.assertBinding(edge, event);
      if (seen.has(event.eventId)) {
        continue;
      }
      seen.add(event.eventId);
      acceptedForPersistence.push(event);
    }
    let persisted: Awaited<ReturnType<CloudSyncPersistence['ingestBatch']>>;
    try {
      persisted = await this.repository.ingestBatch(
        batch.batchId,
        batch.protocolVersion,
        acceptedForPersistence,
      );
    } catch (error) {
      if (error instanceof CloudSyncSequenceConflictError) {
        throw new CloudError(error.code, 409, error.message);
      }
      throw error;
    }
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      batchId: batch.batchId,
      accepted: persisted.accepted,
      duplicates: persisted.duplicates,
      rejected: [...rejected, ...persisted.integrityRejected],
    };
  }

  async heartbeat(edge: CloudEdgeRecord, raw: unknown, now = new Date()): Promise<Date> {
    const heartbeat = EdgeHeartbeatSchema.parse(raw) as EdgeHeartbeat;
    this.assertBinding(edge, heartbeat);
    await this.repository.saveHeartbeat({
      edgeId: heartbeat.edgeId,
      tenantId: heartbeat.tenantId,
      locationId: heartbeat.locationId,
      edgeVersion: heartbeat.edgeVersion,
      schemaVersion: heartbeat.schemaVersion,
      pendingEventCount: heartbeat.pendingEventCount,
      status: heartbeat.status,
      reportedAt: new Date(heartbeat.timestamp),
      receivedAt: now,
    });
    return now;
  }

  private assertBinding(
    edge: CloudEdgeRecord,
    input: { edgeId: string; tenantId: string; locationId: string },
  ): void {
    if (
      input.edgeId !== edge.edgeId ||
      input.tenantId !== edge.tenantId ||
      input.locationId !== edge.locationId
    ) {
      throw new CloudError(
        'EDGE_SCOPE_MISMATCH',
        403,
        'Edge credential is not authorized for the supplied Tenant/Location.',
      );
    }
  }
}
