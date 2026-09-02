import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;
export type BackupRow = typeof schema.backupRecords.$inferSelect;

export class BackupRepository {
  constructor(private readonly db: DB) {}

  create(input: typeof schema.backupRecords.$inferInsert): void {
    this.db.insert(schema.backupRecords).values(input).run();
  }

  byCommand(commandId: string): BackupRow | null {
    return this.db.select().from(schema.backupRecords)
      .where(eq(schema.backupRecords.commandId, commandId)).get() ?? null;
  }

  get(backupId: string): BackupRow | null {
    return this.db.select().from(schema.backupRecords)
      .where(eq(schema.backupRecords.backupId, backupId)).get() ?? null;
  }

  list(limit = 100): BackupRow[] {
    return this.db.select().from(schema.backupRecords)
      .orderBy(desc(schema.backupRecords.createdAt)).limit(limit).all();
  }

  activeOperationalObligations():{openCashSessions:number;openOrders:number}{
    const openCashSessions=this.db.select({id:schema.cashSessions.id}).from(schema.cashSessions)
      .where(eq(schema.cashSessions.status,'OPEN')).all().length;
    const openOrders=this.db.select({id:schema.orders.id}).from(schema.orders)
      .where(eq(schema.orders.status,'OPEN')).all().length;
    return {openCashSessions,openOrders};
  }

  markVerified(backupId: string, input: { now: Date; sizeBytes: number; hash: string }): void {
    this.db.transaction((tx) => {
      tx.update(schema.backupRecords).set({ status: 'VERIFIED', completedAt: input.now,
        verifiedAt: input.now, sizeBytes: input.sizeBytes, ciphertextSha256: input.hash,
        failureCode: null, failureDetail: null }).where(eq(schema.backupRecords.backupId, backupId)).run();
      tx.update(schema.backupRuntime).set({ workerStatus: 'IDLE', lastSuccessfulBackupAt: input.now,
        lastVerifiedBackupId: backupId, lastFailureCode: null, updatedAt: input.now })
        .where(eq(schema.backupRuntime.singletonKey, 'PRIMARY')).run();
    });
  }

  markFailed(backupId: string, code: string, detail: string, now: Date): void {
    this.db.transaction((tx) => {
      tx.update(schema.backupRecords).set({ status: 'FAILED', completedAt: now,
        failureCode: code.slice(0, 100), failureDetail: detail.slice(0, 500) })
        .where(eq(schema.backupRecords.backupId, backupId)).run();
      tx.update(schema.backupRuntime).set({ workerStatus: 'DEGRADED', lastFailureCode: code.slice(0, 100),
        updatedAt: now }).where(eq(schema.backupRuntime.singletonKey, 'PRIMARY')).run();
    });
  }

  startAttempt(nextPeriodicBackupAt: Date, now: Date): boolean {
    const result = this.db.update(schema.backupRuntime).set({ workerStatus: 'RUNNING', lastAttemptAt: now,
      nextPeriodicBackupAt, updatedAt: now }).where(eq(schema.backupRuntime.workerStatus, 'IDLE')).run();
    return result.changes === 1;
  }

  finishWithoutBackup(now: Date): void {
    this.db.update(schema.backupRuntime).set({ workerStatus: 'IDLE', updatedAt: now })
      .where(eq(schema.backupRuntime.singletonKey, 'PRIMARY')).run();
  }

  runtime() {
    return this.db.select().from(schema.backupRuntime)
      .where(eq(schema.backupRuntime.singletonKey, 'PRIMARY')).get()!;
  }

  setNextPeriodic(next: Date, now = new Date()): void {
    this.db.update(schema.backupRuntime).set({ nextPeriodicBackupAt: next, updatedAt: now })
      .where(eq(schema.backupRuntime.singletonKey, 'PRIMARY')).run();
  }

  recoverInterrupted(now = new Date()): void {
    this.db.transaction((tx) => {
      tx.update(schema.backupRecords).set({ status: 'FAILED', completedAt: now,
        failureCode: 'BACKUP_INTERRUPTED', failureDetail: 'Backup process ended before verification.' })
        .where(eq(schema.backupRecords.status, 'CREATING')).run();
      tx.update(schema.backupRuntime).set({ workerStatus: 'IDLE',
        lastFailureCode: 'BACKUP_INTERRUPTED', updatedAt: now })
        .where(eq(schema.backupRuntime.workerStatus, 'RUNNING')).run();
    });
  }

  markDeleted(backupId: string): void {
    this.db.update(schema.backupRecords).set({ status: 'DELETED' })
      .where(eq(schema.backupRecords.backupId, backupId)).run();
  }
}
