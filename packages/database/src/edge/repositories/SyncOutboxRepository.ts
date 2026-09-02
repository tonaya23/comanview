import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EntityId } from '@comanview/domain';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface EdgeInstallationIdentity {
  edgeId: string;
  tenantId: string;
  locationId: string;
  recoveryEpoch: number;
}

export interface DurableEdgeIdentity extends EdgeInstallationIdentity {
  provisioningState: string;
  credentialId: string | null;
  provisioningAttemptId: string | null;
}

export interface EdgeProvisioningJournalRecord {
  edgeId: string; attemptId: string; credentialId: string;
  state: 'CREDENTIAL_STORED' | 'EXCHANGED' | 'ACTIVE';
}

export interface SyncOutboxEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number | null;
  payload: string;
  occurredAt: Date;
  localSequence: number;
  recoveryEpoch: number;
  attemptCount: number;
}

export interface DurableSyncState {
  cloudReachable: boolean | null;
  lastSuccessfulSyncAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastError: string | null;
}

export class SyncOutboxRepository {
  constructor(private readonly db: DB) {}

  ensureIdentity(input: {
    configuredEdgeId: string | null;
    tenantId: string;
    locationId: string;
  }): EdgeInstallationIdentity {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(schema.edgeInstallations).get();
      if (existing) {
        if (existing.tenantId !== input.tenantId || existing.locationId !== input.locationId) {
          throw new Error('Persisted Edge identity does not match Tenant/Location configuration.');
        }
        if (input.configuredEdgeId && existing.edgeId !== input.configuredEdgeId) {
          throw new Error('COMANVIEW_EDGE_ID cannot replace the immutable persisted edgeId.');
        }
        return {
          edgeId: existing.edgeId,
          tenantId: existing.tenantId,
          locationId: existing.locationId,
          recoveryEpoch: existing.recoveryEpoch,
        };
      }
      const edgeId = input.configuredEdgeId ?? EntityId.generate().toString();
      EntityId.fromString(edgeId);
      tx.insert(schema.edgeInstallations)
        .values({
          singletonKey: 'PRIMARY',
          edgeId,
          tenantId: input.tenantId,
          locationId: input.locationId,
          createdAt: new Date(),
        })
        .run();
      return { edgeId, tenantId: input.tenantId, locationId: input.locationId, recoveryEpoch: 0 };
    });
  }

  getIdentity(): EdgeInstallationIdentity {
    const row = this.db.select().from(schema.edgeInstallations).get();
    if (!row) throw new Error('Edge identity has not been initialized.');
    return { edgeId: row.edgeId, tenantId: row.tenantId, locationId: row.locationId, recoveryEpoch: row.recoveryEpoch };
  }

  findIdentity(): DurableEdgeIdentity | null {
    const row = this.db.select().from(schema.edgeInstallations).get();
    return row ? { edgeId: row.edgeId, tenantId: row.tenantId, locationId: row.locationId, recoveryEpoch: row.recoveryEpoch,
      provisioningState: row.provisioningState, credentialId: row.credentialId,
      provisioningAttemptId: row.provisioningAttemptId } : null;
  }

  beginProvisioning(input: { edgeId: string; attemptId: string; credentialId: string }, now = new Date()): EdgeProvisioningJournalRecord {
    const existing = this.getProvisioningJournal();
    if (existing) {
      if (existing.edgeId !== input.edgeId || existing.attemptId !== input.attemptId || existing.credentialId !== input.credentialId) {
        throw new Error('A different Edge provisioning attempt is already in progress.');
      }
      return existing;
    }
    this.db.insert(schema.edgeProvisioningJournal).values({ singletonKey: 'PRIMARY', ...input,
      state: 'CREDENTIAL_STORED', createdAt: now, updatedAt: now }).run();
    return { ...input, state: 'CREDENTIAL_STORED' };
  }

  getProvisioningJournal(): EdgeProvisioningJournalRecord | null {
    const row = this.db.select().from(schema.edgeProvisioningJournal).get();
    return row ? { edgeId: row.edgeId, attemptId: row.attemptId, credentialId: row.credentialId,
      state: row.state as EdgeProvisioningJournalRecord['state'] } : null;
  }

  recordProvisioningExchange(input: { tenantId: string; locationId: string }, now = new Date()): DurableEdgeIdentity {
    return this.db.transaction((tx) => {
      const journal = tx.select().from(schema.edgeProvisioningJournal).get();
      if (!journal) throw new Error('Edge provisioning has not been initialized.');
      tx.insert(schema.edgeInstallations).values({ singletonKey: 'PRIMARY', edgeId: journal.edgeId,
        tenantId: input.tenantId, locationId: input.locationId, provisioningState: 'PROVISIONING',
        credentialId: journal.credentialId, provisioningAttemptId: journal.attemptId,
        createdAt: now, provisionedAt: now }).onConflictDoUpdate({ target: schema.edgeInstallations.singletonKey,
          set: { tenantId: input.tenantId, locationId: input.locationId, provisioningState: 'PROVISIONING',
            credentialId: journal.credentialId, provisioningAttemptId: journal.attemptId, provisionedAt: now } }).run();
      tx.update(schema.edgeProvisioningJournal).set({ state: 'EXCHANGED', updatedAt: now }).run();
      return { edgeId: journal.edgeId, tenantId: input.tenantId, locationId: input.locationId, recoveryEpoch: 0,
        provisioningState: 'PROVISIONING', credentialId: journal.credentialId,
        provisioningAttemptId: journal.attemptId };
    });
  }

  markProvisioningActive(now = new Date()): void {
    this.db.transaction((tx) => {
      tx.update(schema.edgeInstallations).set({ provisioningState: 'ACTIVE', activatedAt: now }).run();
      tx.update(schema.edgeProvisioningJournal).set({ state: 'ACTIVE', updatedAt: now }).run();
    });
  }

  claimBatch(limit: number, leaseDurationMs: number, now = new Date()): SyncOutboxEvent[] {
    return this.db.transaction((tx) => {
      // localSequence is the Edge commit order. A retryable head event blocks later
      // events until it succeeds or becomes explicitly permanent (FAILED with no
      // nextAttemptAt), preventing N+1 from overtaking N in Cloud.
      const unresolved = tx
        .select()
        .from(schema.eventLog)
        .where(
          or(
            eq(schema.eventLog.syncStatus, 'PENDING'),
            and(
              eq(schema.eventLog.syncStatus, 'FAILED'),
              sql`${schema.eventLog.nextAttemptAt} IS NOT NULL`,
            ),
            eq(schema.eventLog.syncStatus, 'SYNCING'),
          ),
        )
        .orderBy(asc(schema.eventLog.recoveryEpoch), asc(schema.eventLog.localSequence), asc(schema.eventLog.id))
        .limit(limit)
        .all();
      const eligible: typeof unresolved = [];
      for (const row of unresolved) {
        const canClaim =
          row.syncStatus === 'PENDING' ||
          (row.syncStatus === 'FAILED' && row.nextAttemptAt !== null && row.nextAttemptAt <= now) ||
          (row.syncStatus === 'SYNCING' &&
            row.leaseExpiresAt !== null &&
            row.leaseExpiresAt <= now);
        if (!canClaim) break;
        eligible.push(row);
        if (eligible.length >= limit) break;
      }
      if (eligible.length === 0) return [];
      const ids = eligible.map((row) => row.id);
      tx.update(schema.eventLog)
        .set({
          syncStatus: 'SYNCING',
          lastAttemptAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
          nextAttemptAt: null,
          attemptCount: sql`${schema.eventLog.attemptCount} + 1`,
        })
        .where(inArray(schema.eventLog.id, ids))
        .run();
      return eligible.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.version,
        payload: row.payload,
        occurredAt: row.occurredAt,
        localSequence: row.localSequence ?? 0,
        recoveryEpoch: row.recoveryEpoch,
        attemptCount: row.attemptCount + 1,
      }));
    });
  }

  markSynced(eventIds: string[], now = new Date()): void {
    if (eventIds.length === 0) return;
    this.db
      .update(schema.eventLog)
      .set({
        syncStatus: 'SYNCED',
        syncedAt: now,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastError: null,
      })
      .where(inArray(schema.eventLog.id, eventIds))
      .run();
  }

  markFailed(eventId: string, error: string, nextAttemptAt: Date | null): void {
    this.db
      .update(schema.eventLog)
      .set({
        syncStatus: 'FAILED',
        leaseExpiresAt: null,
        nextAttemptAt,
        lastError: error.slice(0, 1_000),
      })
      .where(eq(schema.eventLog.id, eventId))
      .run();
  }

  getCounts(): { pendingCount: number; failedCount: number; syncingCount: number } {
    const rows = this.db
      .select({ status: schema.eventLog.syncStatus, count: sql<number>`count(*)` })
      .from(schema.eventLog)
      .where(inArray(schema.eventLog.syncStatus, ['PENDING', 'FAILED', 'SYNCING']))
      .groupBy(schema.eventLog.syncStatus)
      .all();
    const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
    return {
      pendingCount: counts.get('PENDING') ?? 0,
      failedCount: counts.get('FAILED') ?? 0,
      syncingCount: counts.get('SYNCING') ?? 0,
    };
  }

  getEventStatus(eventId: string): string | null {
    return (
      this.db
        .select({ status: schema.eventLog.syncStatus })
        .from(schema.eventLog)
        .where(eq(schema.eventLog.id, eventId))
        .get()?.status ?? null
    );
  }

  getLatestFailedError(): string | null {
    return (
      this.db
        .select({ error: schema.eventLog.lastError })
        .from(schema.eventLog)
        .where(eq(schema.eventLog.syncStatus, 'FAILED'))
        .orderBy(desc(schema.eventLog.lastAttemptAt), desc(schema.eventLog.occurredAt))
        .limit(1)
        .get()?.error ?? null
    );
  }

  getState(): DurableSyncState {
    const row = this.db
      .select()
      .from(schema.syncRuntimeState)
      .where(eq(schema.syncRuntimeState.singletonKey, 'PRIMARY'))
      .get();
    return {
      cloudReachable: row?.cloudReachable ?? null,
      lastSuccessfulSyncAt: row?.lastSuccessfulSyncAt ?? null,
      lastHeartbeatAt: row?.lastHeartbeatAt ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  recordSyncSuccess(now = new Date()): void {
    this.updateState({ cloudReachable: true, lastSuccessfulSyncAt: now, lastError: null });
  }

  recordHeartbeatSuccess(now = new Date()): void {
    this.updateState({ cloudReachable: true, lastHeartbeatAt: now, lastError: null });
  }

  recordCloudFailure(error: string): void {
    this.updateState({ cloudReachable: false, lastError: error.slice(0, 1_000) });
  }

  private updateState(values: Partial<typeof schema.syncRuntimeState.$inferInsert>): void {
    this.db
      .insert(schema.syncRuntimeState)
      .values({ singletonKey: 'PRIMARY', ...values })
      .onConflictDoUpdate({ target: schema.syncRuntimeState.singletonKey, set: values })
      .run();
  }
}
