import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  PrintJob,
  PrintJobPayload,
  PrintJobStatus,
  PrintJobType,
  PrintQueue,
  PrintTarget,
  PrintTargetAdapterType,
} from '@comanview/printing';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export type NewPrintJob = Omit<
  PrintJob,
  'status' | 'attempts' | 'updatedAt' | 'nextAttemptAt' | 'lastError'
>;

function mapTarget(row: typeof schema.printTargets.$inferSelect): PrintTarget {
  return {
    targetId: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    stationId: row.stationId,
    name: row.name,
    adapterType: row.adapterType as PrintTargetAdapterType,
    active: Boolean(row.active),
    configuration: JSON.parse(row.configurationJson) as Record<string, unknown>,
  };
}

function mapJob(row: typeof schema.printJobs.$inferSelect): PrintJob {
  return {
    printJobId: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    orderId: row.orderId,
    cashSessionId: row.cashSessionId,
    roundId: row.roundId,
    stationId: row.stationId,
    targetId: row.targetId,
    jobType: row.jobType as PrintJobType,
    payload: JSON.parse(row.payload) as PrintJobPayload,
    status: row.status as PrintJobStatus,
    attempts: row.attempts,
    createdAt: new Date(row.createdAt as unknown as number),
    updatedAt: new Date(row.updatedAt as unknown as number),
    nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt as unknown as number) : null,
    lastError: row.lastError,
    parentJobId: row.parentJobId,
    dedupeKey: row.dedupeKey,
  };
}

export function insertPrintJobs(db: DB, jobs: ReadonlyArray<NewPrintJob>): void {
  for (const job of jobs) {
    db.insert(schema.printJobs)
      .values({
        id: job.printJobId,
        tenantId: job.tenantId,
        locationId: job.locationId,
        orderId: job.orderId,
        cashSessionId: job.cashSessionId ?? null,
        roundId: job.roundId,
        stationId: job.stationId,
        targetId: job.targetId,
        jobType: job.jobType,
        payload: JSON.stringify(job.payload),
        status: 'PENDING',
        attempts: 0,
        createdAt: job.createdAt,
        updatedAt: job.createdAt,
        nextAttemptAt: job.createdAt,
        lastError: null,
        parentJobId: job.parentJobId,
        dedupeKey: job.dedupeKey,
      })
      .onConflictDoNothing({ target: schema.printJobs.dedupeKey })
      .run();
  }
}

export class PrintJobRepository implements PrintQueue {
  constructor(private readonly db: DB) {}

  getStation(stationId: string): { id: string; name: string } | null {
    const row = this.db
      .select()
      .from(schema.stations)
      .where(eq(schema.stations.id, stationId))
      .get();
    return row && row.active ? { id: row.id, name: row.name } : null;
  }

  getTargetForStation(stationId: string): PrintTarget | null {
    const row = this.db
      .select()
      .from(schema.printTargets)
      .where(
        and(eq(schema.printTargets.stationId, stationId), eq(schema.printTargets.active, true)),
      )
      .get();
    return row ? mapTarget(row) : null;
  }

  getDefaultTarget(): PrintTarget | null {
    const row = this.db
      .select()
      .from(schema.printTargets)
      .where(and(isNull(schema.printTargets.stationId), eq(schema.printTargets.active, true)))
      .get();
    return row ? mapTarget(row) : null;
  }

  enqueue(jobs: ReadonlyArray<NewPrintJob>, commandId: string): void {
    this.db.transaction((tx) => {
      const db = tx as unknown as DB;
      db.insert(schema.processedCommands).values({ commandId, processedAt: new Date() }).run();
      insertPrintJobs(db, jobs);
    });
  }

  listRecent(limit = 20): PrintJob[] {
    return this.db
      .select()
      .from(schema.printJobs)
      .orderBy(desc(schema.printJobs.createdAt))
      .limit(limit)
      .all()
      .map(mapJob);
  }

  getByDedupeKey(dedupeKey: string): PrintJob | null {
    const row = this.db
      .select()
      .from(schema.printJobs)
      .where(eq(schema.printJobs.dedupeKey, dedupeKey))
      .get();
    return row ? mapJob(row) : null;
  }

  recoverInterruptedJobs(): number {
    return this.db
      .update(schema.printJobs)
      .set({
        status: 'UNKNOWN',
        updatedAt: new Date(),
        lastError: 'Edge restarted while transmission was in progress.',
        nextAttemptAt: null,
      })
      .where(eq(schema.printJobs.status, 'SENDING'))
      .run().changes;
  }

  claimNext(now: Date): { job: PrintJob; target: PrintTarget | null } | null {
    return this.db.transaction((tx) => {
      const db = tx as unknown as DB;
      const row = db
        .select()
        .from(schema.printJobs)
        .where(
          or(
            eq(schema.printJobs.status, 'PENDING'),
            and(
              eq(schema.printJobs.status, 'FAILED'),
              isNotNull(schema.printJobs.nextAttemptAt),
              lte(schema.printJobs.nextAttemptAt, now),
            ),
          ),
        )
        .orderBy(asc(schema.printJobs.createdAt))
        .get();
      if (!row) return null;
      const claimedAt = new Date();
      const result = db
        .update(schema.printJobs)
        .set({
          status: 'SENDING',
          attempts: row.attempts + 1,
          updatedAt: claimedAt,
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(schema.printJobs.id, row.id),
            inArray(schema.printJobs.status, ['PENDING', 'FAILED']),
          ),
        )
        .run();
      if (result.changes !== 1) return null;
      const claimed = mapJob({
        ...row,
        status: 'SENDING',
        attempts: row.attempts + 1,
        updatedAt: claimedAt,
        nextAttemptAt: null,
      });
      const targetRow = row.targetId
        ? db
            .select()
            .from(schema.printTargets)
            .where(
              and(eq(schema.printTargets.id, row.targetId), eq(schema.printTargets.active, true)),
            )
            .get()
        : undefined;
      return { job: claimed, target: targetRow ? mapTarget(targetRow) : null };
    });
  }

  markDelivered(printJobId: string, _detail?: string): void {
    this.db
      .update(schema.printJobs)
      .set({ status: 'DELIVERED', updatedAt: new Date(), nextAttemptAt: null, lastError: null })
      .where(eq(schema.printJobs.id, printJobId))
      .run();
  }
  markFailed(printJobId: string, error: string, nextAttemptAt: Date | null): void {
    this.db
      .update(schema.printJobs)
      .set({ status: 'FAILED', updatedAt: new Date(), nextAttemptAt, lastError: error })
      .where(eq(schema.printJobs.id, printJobId))
      .run();
  }
  markUnknown(printJobId: string, error: string): void {
    this.db
      .update(schema.printJobs)
      .set({ status: 'UNKNOWN', updatedAt: new Date(), nextAttemptAt: null, lastError: error })
      .where(eq(schema.printJobs.id, printJobId))
      .run();
  }
}
