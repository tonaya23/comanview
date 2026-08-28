import { eq, inArray, sql } from 'drizzle-orm';
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
  ): Promise<{ accepted: string[]; duplicates: string[] }> {
    return this.db.transaction(async (tx) => {
      const eventIds = events.map((event) => event.eventId);
      if (eventIds.length === 0) return { accepted: [], duplicates: [] };
      const existing = await tx
        .select({ eventId: schema.cloudSyncInbox.eventId })
        .from(schema.cloudSyncInbox)
        .where(inArray(schema.cloudSyncInbox.eventId, eventIds));
      const existingIds = new Set(existing.map((row) => row.eventId));
      const candidates = events.filter((event) => !existingIds.has(event.eventId));
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
      return { accepted, duplicates: eventIds.filter((id) => !acceptedIds.has(id)) };
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
