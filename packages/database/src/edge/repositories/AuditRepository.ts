import { createHash } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;
export type AuditAction =
  | 'PAYMENT_VOIDED'
  | 'CASH_MOVEMENT_CREATED'
  | 'CASH_X_REPORT_GENERATED'
  | 'CASH_SESSION_CLOSED'
  | 'ORDER_EMPTY_CANCELLED'
  | 'LICENSE_RECOVERY_CASH_SESSION_OPENED'
  | 'DEVICE_PAIRING_CREATED' | 'DEVICE_PAIRED' | 'DEVICE_PAIRING_FAILED'
  | 'DEVICE_PAIRING_RATE_LIMITED' | 'DEVICE_PAIRING_CANCELLED' | 'DEVICE_REVOKED'
  | 'FIRST_DEVICE_BOOTSTRAP_COMPLETED' | 'DEVICE_LIMIT_EXCEEDED_ATTEMPT';
export type AuditEntityType =
  'PAYMENT' | 'CASH_MOVEMENT' | 'CASH_REPORT' | 'CASH_SESSION' | 'ORDER' | 'DEVICE' | 'PAIRING' | 'INSTALLATION';

export interface NewAuditEntry {
  auditId: string;
  occurredAt: Date;
  tenantId: string;
  locationId: string;
  deviceId: string | null;
  sessionId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  actorType?: 'USER' | 'CLOUD_ADMIN_AUTHORIZATION' | 'SYSTEM';
  authorizationId?: string | null;
  source?: string | null;
  authorizedByUserId: string | null;
  authorizedByRole: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  outcome: 'SUCCESS' | 'REJECTED';
  reason: string;
  commandId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  amountAffected: number | null;
  currency: string | null;
  eventId: string | null;
}

export interface AuditRecord extends NewAuditEntry {
  previousHash: string | null;
  entryHash: string;
}

export interface AuditFilters {
  action?: AuditAction;
  actorUserId?: string;
  resourceId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  locationId: string;
}

export class AuditPersistenceError extends Error {
  constructor(cause: unknown) {
    super('Required Audit Log entry could not be persisted.', { cause });
    this.name = 'AuditPersistenceError';
  }
}

function serializeForHash(entry: NewAuditEntry, previousHash: string | null): string {
  const legacy = {
    auditId: entry.auditId,
    occurredAt: entry.occurredAt.toISOString(),
    tenantId: entry.tenantId,
    locationId: entry.locationId,
    deviceId: entry.deviceId,
    sessionId: entry.sessionId,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    authorizedByUserId: entry.authorizedByUserId,
    authorizedByRole: entry.authorizedByRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    outcome: entry.outcome,
    reason: entry.reason,
    commandId: entry.commandId,
    before: entry.before,
    after: entry.after,
    amountAffected: entry.amountAffected,
    currency: entry.currency,
    eventId: entry.eventId,
    previousHash,
  };
  if ((entry.actorType ?? 'USER') === 'USER' && !entry.authorizationId && !entry.source) {
    return JSON.stringify(legacy);
  }
  return JSON.stringify({
    auditId: entry.auditId, occurredAt: entry.occurredAt.toISOString(), tenantId: entry.tenantId,
    locationId: entry.locationId, deviceId: entry.deviceId, sessionId: entry.sessionId,
    actorUserId: entry.actorUserId, actorRole: entry.actorRole, actorType: entry.actorType ?? 'USER',
    authorizationId: entry.authorizationId ?? null, source: entry.source ?? null,
    authorizedByUserId: entry.authorizedByUserId, authorizedByRole: entry.authorizedByRole,
    action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
    outcome: entry.outcome, reason: entry.reason, commandId: entry.commandId,
    before: entry.before, after: entry.after, amountAffected: entry.amountAffected,
    currency: entry.currency, eventId: entry.eventId, previousHash,
  });
}

export function insertAuditEntry(db: DB, entry: NewAuditEntry): AuditRecord {
  try {
    const previous = db
      .select({ entryHash: schema.auditLog.entryHash })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.locationId, entry.locationId))
      .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.auditId))
      .limit(1)
      .get();
    const previousHash = previous?.entryHash ?? null;
    const entryHash = createHash('sha256')
      .update(serializeForHash(entry, previousHash), 'utf8')
      .digest('hex');

    db.insert(schema.auditLog)
      .values({
        ...entry,
        beforeJson: entry.before ? JSON.stringify(entry.before) : null,
        afterJson: entry.after ? JSON.stringify(entry.after) : null,
        previousHash,
        entryHash,
      })
      .run();
    return { ...entry, previousHash, entryHash };
  } catch (error) {
    throw new AuditPersistenceError(error);
  }
}

export class AuditRepository {
  constructor(private readonly db: DB) {}

  getByCommand(commandId: string, action: AuditAction): AuditRecord | null {
    const row = this.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.commandId, commandId), eq(schema.auditLog.action, action)))
      .get();
    return row ? this.mapRow(row) : null;
  }

  list(filters: AuditFilters): AuditRecord[] {
    const conditions = [eq(schema.auditLog.locationId, filters.locationId)];
    if (filters.action) conditions.push(eq(schema.auditLog.action, filters.action));
    if (filters.actorUserId) conditions.push(eq(schema.auditLog.actorUserId, filters.actorUserId));
    if (filters.resourceId) conditions.push(eq(schema.auditLog.entityId, filters.resourceId));
    if (filters.from) conditions.push(gte(schema.auditLog.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(schema.auditLog.occurredAt, filters.to));

    return this.db
      .select()
      .from(schema.auditLog)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.auditId))
      .limit(filters.limit)
      .all()
      .map((row) => this.mapRow(row));
  }

  private mapRow(row: typeof schema.auditLog.$inferSelect): AuditRecord {
    return {
      auditId: row.auditId,
      occurredAt: row.occurredAt,
      tenantId: row.tenantId,
      locationId: row.locationId,
      deviceId: row.deviceId,
      sessionId: row.sessionId,
      actorUserId: row.actorUserId,
      actorRole: row.actorRole,
      actorType: row.actorType as 'USER' | 'CLOUD_ADMIN_AUTHORIZATION' | 'SYSTEM',
      authorizationId: row.authorizationId,
      source: row.source,
      authorizedByUserId: row.authorizedByUserId,
      authorizedByRole: row.authorizedByRole,
      action: row.action as AuditAction,
      entityType: row.entityType as AuditEntityType,
      entityId: row.entityId,
      outcome: row.outcome as 'SUCCESS' | 'REJECTED',
      reason: row.reason,
      commandId: row.commandId,
      before: row.beforeJson ? (JSON.parse(row.beforeJson) as Record<string, unknown>) : null,
      after: row.afterJson ? (JSON.parse(row.afterJson) as Record<string, unknown>) : null,
      amountAffected: row.amountAffected,
      currency: row.currency,
      eventId: row.eventId,
      previousHash: row.previousHash,
      entryHash: row.entryHash,
    };
  }
}
