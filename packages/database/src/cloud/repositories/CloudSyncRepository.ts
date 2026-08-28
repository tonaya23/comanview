import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SyncEventEnvelope } from '@comanview/sync';
import type { CloudDatabase } from '../db.js';
import * as schema from '../schema.js';

export interface CloudEdgeRecord {
  edgeId: string;
  tenantId: string;
  locationId: string;
  credentialHash: string;
  status: string;
}

export interface SyncIntegrityRejection {
  eventId: string;
  code: 'SYNC_LOCAL_SEQUENCE_CONFLICT';
  message: string;
}

export class CloudSyncSequenceConflictError extends Error {
  readonly code = 'SYNC_LOCAL_SEQUENCE_CONFLICT';

  constructor() {
    super('An Edge local sequence is already bound to a different event.');
    this.name = 'CloudSyncSequenceConflictError';
  }
}

export class CloudSyncRepository {
  constructor(private readonly db: CloudDatabase) {}

  getEdge(edgeId: string): Promise<CloudEdgeRecord | null> {
    return this.db
      .select({
        edgeId: schema.cloudEdges.edgeId,
        tenantId: schema.cloudEdges.tenantId,
        locationId: schema.cloudEdges.locationId,
        credentialHash: schema.cloudEdges.credentialHash,
        status: schema.cloudEdges.status,
      })
      .from(schema.cloudEdges)
      .where(eq(schema.cloudEdges.edgeId, edgeId))
      .then((rows) => rows[0] ?? null);
  }

  async provisionEdge(input: {
    edgeId: string;
    tenantId: string;
    locationId: string;
    credentialHash: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ tenantId: schema.cloudEdges.tenantId, locationId: schema.cloudEdges.locationId })
        .from(schema.cloudEdges)
        .where(eq(schema.cloudEdges.edgeId, input.edgeId))
        .then((rows) => rows[0]);
      if (
        existing &&
        (existing.tenantId !== input.tenantId || existing.locationId !== input.locationId)
      ) {
        throw new Error('Configured Edge cannot be rebound to another Tenant/Location.');
      }
      await tx
        .insert(schema.cloudEdges)
        .values({ ...input, status: 'ACTIVE' })
        .onConflictDoUpdate({
          target: schema.cloudEdges.edgeId,
          set: {
            credentialHash: input.credentialHash,
            status: 'ACTIVE',
            updatedAt: new Date(),
          },
        });
    });
  }

  ingestBatch(
    batchId: string,
    protocolVersion: string,
    events: SyncEventEnvelope[],
  ): Promise<{
    accepted: string[];
    duplicates: string[];
    integrityRejected: SyncIntegrityRejection[];
  }> {
    return this.db
      .transaction(async (tx) => {
        const eventIds = events.map((event) => event.eventId);
        if (eventIds.length === 0) {
          return { accepted: [], duplicates: [], integrityRejected: [] };
        }
        const existing = await tx
          .select({ eventId: schema.cloudSyncInbox.eventId })
          .from(schema.cloudSyncInbox)
          .where(inArray(schema.cloudSyncInbox.eventId, eventIds));
        const existingIds = new Set(existing.map((row) => row.eventId));
        const newEvents = events.filter((event) => !existingIds.has(event.eventId));
        const edges = [...new Set(newEvents.map((event) => event.edgeId))];
        const persistedSequences = new Map<string, string>();
        for (const edgeId of edges) {
          const sequences = newEvents
            .filter((event) => event.edgeId === edgeId)
            .map((event) => event.localSequence);
          if (sequences.length === 0) continue;
          const rows = await tx
            .select({
              eventId: schema.cloudSyncInbox.eventId,
              localSequence: schema.cloudSyncInbox.localSequence,
            })
            .from(schema.cloudSyncInbox)
            .where(
              and(
                eq(schema.cloudSyncInbox.edgeId, edgeId),
                inArray(schema.cloudSyncInbox.localSequence, sequences),
              ),
            );
          for (const row of rows) {
            persistedSequences.set(`${edgeId}:${row.localSequence}`, row.eventId);
          }
        }

        const integrityRejected: SyncIntegrityRejection[] = [];
        const batchSequences = new Map<string, string>();
        const candidates = newEvents.filter((event) => {
          const key = `${event.edgeId}:${event.localSequence}`;
          const boundEventId = persistedSequences.get(key) ?? batchSequences.get(key);
          if (boundEventId && boundEventId !== event.eventId) {
            integrityRejected.push({
              eventId: event.eventId,
              code: 'SYNC_LOCAL_SEQUENCE_CONFLICT',
              message: 'Edge local sequence is already bound to a different event.',
            });
            return false;
          }
          batchSequences.set(key, event.eventId);
          return true;
        });
        const inserted =
          candidates.length === 0
            ? []
            : await tx
                .insert(schema.cloudSyncInbox)
                .values(
                  candidates.map((event) => ({
                    eventId: event.eventId,
                    schemaVersion: event.schemaVersion,
                    protocolVersion,
                    eventType: event.eventType,
                    aggregateType: event.aggregateType,
                    aggregateId: event.aggregateId,
                    aggregateVersion: event.aggregateVersion,
                    tenantId: event.tenantId,
                    locationId: event.locationId,
                    edgeId: event.edgeId,
                    batchId,
                    localSequence: event.localSequence,
                    payload: event.payload,
                    occurredAt: new Date(event.occurredAt),
                  })),
                )
                .onConflictDoNothing({ target: schema.cloudSyncInbox.eventId })
                .returning({ eventId: schema.cloudSyncInbox.eventId });
        const accepted = inserted.map((row) => row.eventId);
        const acceptedIds = new Set(accepted);
        const rejectedIds = new Set(integrityRejected.map((item) => item.eventId));
        return {
          accepted,
          duplicates: eventIds.filter((id) => !acceptedIds.has(id) && !rejectedIds.has(id)),
          integrityRejected,
        };
      })
      .catch((error: unknown) => {
        const cause = error as { code?: string; constraint?: string; cause?: unknown };
        const nested = cause.cause as { code?: string; constraint?: string } | undefined;
        const code = cause.code ?? nested?.code;
        const constraint = cause.constraint ?? nested?.constraint;
        if (code === '23505' && constraint === 'unq_cloud_sync_inbox_edge_sequence') {
          throw new CloudSyncSequenceConflictError();
        }
        throw error;
      });
  }

  async saveHeartbeat(input: {
    edgeId: string;
    tenantId: string;
    locationId: string;
    edgeVersion: string;
    schemaVersion: string;
    pendingEventCount: number;
    status: string;
    reportedAt: Date;
    receivedAt: Date;
  }): Promise<void> {
    await this.db
      .insert(schema.edgeHeartbeats)
      .values({
        edgeId: input.edgeId,
        tenantId: input.tenantId,
        locationId: input.locationId,
        lastSeenAt: input.receivedAt,
        edgeVersion: input.edgeVersion,
        schemaVersion: input.schemaVersion,
        pendingEventCount: input.pendingEventCount,
        status: input.status,
        reportedAt: input.reportedAt,
      })
      .onConflictDoUpdate({
        target: schema.edgeHeartbeats.edgeId,
        set: {
          lastSeenAt: input.receivedAt,
          edgeVersion: input.edgeVersion,
          schemaVersion: input.schemaVersion,
          pendingEventCount: input.pendingEventCount,
          status: input.status,
          reportedAt: input.reportedAt,
        },
      });
  }

  async countInboxEvents(): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.cloudSyncInbox);
    return rows[0]?.count ?? 0;
  }
}
