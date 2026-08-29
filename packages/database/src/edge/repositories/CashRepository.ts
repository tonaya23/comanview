import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import {
  CashMovement,
  CashRegister,
  CashSession,
  CashSessionAlreadyOpenError,
  EntityId,
} from '@comanview/domain';
import { Money } from '@comanview/money';
import { insertAuditEntry, type NewAuditEntry } from './AuditRepository.js';
import { insertPrintJobs, type NewPrintJob } from './PrintJobRepository.js';

type DB = BetterSQLite3Database<typeof schema>;

type PaymentMethod = 'CASH' | 'CARD' | 'OTHER';
export interface CashFinancialSummary {
  salesByMethod: Record<PaymentMethod, Money>;
  tipsByMethod: Record<PaymentMethod, Money>;
  paymentCountByMethod: Record<PaymentMethod, number>;
  cashIn: Money;
  cashOut: Money;
  expectedCash: Money;
  voidCount: number;
}

export interface StoredCashReport {
  id: string;
  cashSessionId: string;
  reportType: 'X' | 'Z';
  snapshot: Record<string, unknown>;
  generatedAt: Date;
  generatedBy: string;
  commandId: string;
}

export class CashRepository {
  constructor(private readonly db: DB) {}

  saveRegister(register: CashRegister): void {
    this.db
      .insert(schema.cashRegisters)
      .values({
        id: register.id.toString(),
        tenantId: register.tenantId.toString(),
        locationId: register.locationId.toString(),
        name: register.name,
        currency: register.currency,
        active: register.active,
        blindCashCount: register.blindCashCount,
        createdAt: register.createdAt,
      })
      .onConflictDoNothing()
      .run();
  }

  getRegister(id: EntityId): CashRegister | null {
    const row = this.db
      .select()
      .from(schema.cashRegisters)
      .where(eq(schema.cashRegisters.id, id.toString()))
      .get();
    if (!row) return null;
    return new CashRegister({
      id: EntityId.fromString(row.id),
      tenantId: EntityId.fromString(row.tenantId),
      locationId: EntityId.fromString(row.locationId),
      name: row.name,
      currency: row.currency,
      active: row.active,
      blindCashCount: row.blindCashCount,
      createdAt: new Date(row.createdAt as unknown as number),
    });
  }

  openSession(session: CashSession, metadata: {
    purpose: 'NORMAL'|'LICENSE_RECOVERY'; openedLicenseRevision: number|null;
    openedLicenseMode: string; protectedOrderIds: string[]; audit?: NewAuditEntry;
  } = { purpose: 'NORMAL', openedLicenseRevision: null, openedLicenseMode: 'LEGACY', protectedOrderIds: [] }): void {
    try {
      this.db.transaction((tx) => {
        tx.insert(schema.cashSessions)
          .values({
            id: session.id.toString(),
            cashRegisterId: session.cashRegisterId.toString(),
            tenantId: session.tenantId.toString(),
            locationId: session.locationId.toString(),
            openingFloatAmount: session.openingFloat.amount,
            currency: session.openingFloat.currency,
            businessDate: session.businessDate,
            status: session.status,
            openedAt: session.openedAt,
            openedBy: session.openedBy.toString(),
            closedAt: session.closedAt,
            openCommandId: session.openCommandId,
            purpose: metadata.purpose,
            openedLicenseRevision: metadata.openedLicenseRevision,
            openedLicenseMode: metadata.openedLicenseMode,
          })
          .run();

        for (const orderId of metadata.protectedOrderIds) {
          tx.insert(schema.cashSessionProtectedOrders).values({
            cashSessionId: session.id.toString(), orderId,
          }).run();
        }
        if (metadata.purpose === 'LICENSE_RECOVERY') {
          tx.update(schema.edgeControlRuntime).set({ recoverySessionConsumed: true })
            .where(eq(schema.edgeControlRuntime.singletonKey, 'PRIMARY')).run();
        }
        if (metadata.audit) insertAuditEntry(tx as unknown as DB, metadata.audit);

        tx.insert(schema.processedCommands)
          .values({ commandId: session.openCommandId, processedAt: session.openedAt })
          .run();

        const eventId = EntityId.generate();
        tx.insert(schema.eventLog)
          .values({
            id: eventId.toString(),
            eventType: 'CASH_SESSION_OPENED',
            aggregateType: 'CASH_SESSION',
            aggregateId: session.id.toString(),
            version: 1,
            payload: JSON.stringify({
              eventId: eventId.toString(),
              eventType: 'CASH_SESSION_OPENED',
              cashSessionId: session.id.toString(),
              cashRegisterId: session.cashRegisterId.toString(),
              openingFloat: session.openingFloat.toJSON(),
              businessDate: session.businessDate,
            }),
            occurredAt: session.openedAt,
            commandId: session.openCommandId,
            syncStatus: 'PENDING',
          })
          .run();
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('unq_cash_register_open_session') ||
          error.message.includes('cash_sessions.cash_register_id'))
      ) {
        throw new CashSessionAlreadyOpenError(session.cashRegisterId.toString());
      }
      throw error;
    }
  }

  getSessionMetadata(id: string): {
    purpose: 'NORMAL'|'LICENSE_RECOVERY'; openedLicenseRevision: number|null; openedLicenseMode: string|null;
  } | null {
    const row = this.db.select({ purpose: schema.cashSessions.purpose,
      openedLicenseRevision: schema.cashSessions.openedLicenseRevision,
      openedLicenseMode: schema.cashSessions.openedLicenseMode })
      .from(schema.cashSessions).where(eq(schema.cashSessions.id, id)).get();
    return row ? { purpose: row.purpose as 'NORMAL'|'LICENSE_RECOVERY',
      openedLicenseRevision: row.openedLicenseRevision, openedLicenseMode: row.openedLicenseMode } : null;
  }

  getOpenSession(cashRegisterId: EntityId): CashSession | null {
    const row = this.db
      .select()
      .from(schema.cashSessions)
      .where(
        and(
          eq(schema.cashSessions.cashRegisterId, cashRegisterId.toString()),
          eq(schema.cashSessions.status, 'OPEN'),
        ),
      )
      .get();
    return row ? this.mapSession(row) : null;
  }

  getSessionByCommandId(commandId: string): CashSession | null {
    const row = this.db
      .select()
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.openCommandId, commandId))
      .get();
    return row ? this.mapSession(row) : null;
  }

  getSessionById(id: EntityId): CashSession | null {
    const row = this.db
      .select()
      .from(schema.cashSessions)
      .where(eq(schema.cashSessions.id, id.toString()))
      .get();
    return row ? this.mapSession(row) : null;
  }

  getMovementByCommandId(commandId: string): CashMovement | null {
    const row = this.db
      .select()
      .from(schema.cashMovements)
      .where(eq(schema.cashMovements.commandId, commandId))
      .get();
    return row
      ? CashMovement.rehydrate({
          id: EntityId.fromString(row.id),
          cashSessionId: EntityId.fromString(row.cashSessionId),
          type: row.movementType as 'CASH_IN' | 'CASH_OUT',
          amount: Money.fromMinorUnits(row.amount, row.currency),
          reason: row.reason,
          actorUserId: EntityId.fromString(row.actorUserId),
          occurredAt: new Date(row.occurredAt as unknown as number),
          commandId: row.commandId,
        })
      : null;
  }

  getReportByCommandId(commandId: string): StoredCashReport | null {
    const row = this.db
      .select()
      .from(schema.cashReports)
      .where(eq(schema.cashReports.commandId, commandId))
      .get();
    return row ? this.mapReport(row) : null;
  }

  getZReport(cashSessionId: string): StoredCashReport | null {
    const row = this.db
      .select()
      .from(schema.cashReports)
      .where(
        and(
          eq(schema.cashReports.cashSessionId, cashSessionId),
          eq(schema.cashReports.reportType, 'Z'),
        ),
      )
      .get();
    return row ? this.mapReport(row) : null;
  }

  hasPendingPayments(cashSessionId: string): boolean {
    return Boolean(
      this.db
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.cashSessionId, cashSessionId),
            eq(schema.payments.status, 'PENDING'),
          ),
        )
        .get(),
    );
  }

  saveMovement(movement: CashMovement, audit: NewAuditEntry): void {
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;
      db.insert(schema.cashMovements)
        .values({
          id: movement.id.toString(),
          cashSessionId: movement.cashSessionId.toString(),
          movementType: movement.type,
          amount: movement.amount.amount,
          currency: movement.amount.currency,
          reason: movement.reason,
          actorUserId: movement.actorUserId.toString(),
          occurredAt: movement.occurredAt,
          commandId: movement.commandId,
        })
        .run();
      db.insert(schema.processedCommands)
        .values({ commandId: movement.commandId, processedAt: movement.occurredAt })
        .run();
      db.insert(schema.eventLog)
        .values({
          id: audit.eventId!,
          eventType: 'CASH_MOVEMENT_CREATED',
          aggregateType: 'CASH_SESSION',
          aggregateId: movement.cashSessionId.toString(),
          version: null,
          payload: JSON.stringify({
            eventId: audit.eventId,
            eventType: 'CASH_MOVEMENT_CREATED',
            cashMovementId: movement.id.toString(),
            cashSessionId: movement.cashSessionId.toString(),
            movementType: movement.type,
            amount: movement.amount.toJSON(),
            reason: movement.reason,
            actorUserId: movement.actorUserId.toString(),
          }),
          occurredAt: movement.occurredAt,
          commandId: movement.commandId,
          syncStatus: 'PENDING',
        })
        .run();
      insertAuditEntry(db, audit);
    });
  }

  saveXReport(input: {
    id: string;
    cashSessionId: string;
    snapshot: Record<string, unknown>;
    generatedAt: Date;
    generatedBy: string;
    commandId: string;
    audit: NewAuditEntry;
    printJob: NewPrintJob;
  }): void {
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;
      db.insert(schema.cashReports)
        .values({
          id: input.id,
          cashSessionId: input.cashSessionId,
          reportType: 'X',
          snapshotJson: JSON.stringify(input.snapshot),
          generatedAt: input.generatedAt,
          generatedBy: input.generatedBy,
          commandId: input.commandId,
        })
        .run();
      db.insert(schema.processedCommands)
        .values({ commandId: input.commandId, processedAt: input.generatedAt })
        .run();
      insertAuditEntry(db, input.audit);
      insertPrintJobs(db, [input.printJob]);
    });
  }

  closeSession(input: {
    session: CashSession;
    reportId: string;
    snapshot: Record<string, unknown>;
    audit: NewAuditEntry;
    printJob: NewPrintJob;
  }): void {
    const session = input.session;
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;
      const updated = db
        .update(schema.cashSessions)
        .set({
          status: 'CLOSED',
          closedAt: session.closedAt,
          closedBy: session.closedBy!.toString(),
          closeCommandId: session.closeCommandId,
          expectedCashAtCloseAmount: session.expectedCashAtClose!.amount,
          countedCashAmount: session.countedCash!.amount,
          differenceAmount: session.difference!.amount,
        })
        .where(
          and(eq(schema.cashSessions.id, session.id.toString()), eq(schema.cashSessions.status, 'OPEN')),
        )
        .run();
      if (updated.changes !== 1) throw new Error('CashSession close lost its OPEN state.');
      db.insert(schema.cashReports)
        .values({
          id: input.reportId,
          cashSessionId: session.id.toString(),
          reportType: 'Z',
          snapshotJson: JSON.stringify(input.snapshot),
          generatedAt: session.closedAt!,
          generatedBy: session.closedBy!.toString(),
          commandId: session.closeCommandId!,
        })
        .run();
      db.insert(schema.processedCommands)
        .values({ commandId: session.closeCommandId!, processedAt: session.closedAt! })
        .run();
      db.insert(schema.eventLog)
        .values({
          id: input.audit.eventId!,
          eventType: 'CASH_SESSION_CLOSED',
          aggregateType: 'CASH_SESSION',
          aggregateId: session.id.toString(),
          version: null,
          payload: JSON.stringify({
            eventId: input.audit.eventId,
            eventType: 'CASH_SESSION_CLOSED',
            cashSessionId: session.id.toString(),
            businessDate: session.businessDate,
            expectedCash: session.expectedCashAtClose!.toJSON(),
            countedCash: session.countedCash!.toJSON(),
            difference: session.difference!.toJSON(),
            closedBy: session.closedBy!.toString(),
          }),
          occurredAt: session.closedAt!,
          commandId: session.closeCommandId,
          syncStatus: 'PENDING',
        })
        .run();
      insertAuditEntry(db, input.audit);
      insertPrintJobs(db, [input.printJob]);
    });
  }

  calculateExpectedCash(session: CashSession): Money {
    return this.calculateFinancialSummary(session).expectedCash;
  }

  calculateFinancialSummary(session: CashSession): CashFinancialSummary {
    const payments = this.db
      .select({
        method: schema.payments.method,
        status: schema.payments.status,
        amountApplied: schema.payments.amountAppliedAmount,
        tipAmount: schema.payments.tipAmount,
        currency: schema.payments.currency,
      })
      .from(schema.payments)
      .where(eq(schema.payments.cashSessionId, session.id.toString()))
      .all();
    const currency = session.openingFloat.currency;
    const methods = ['CASH', 'CARD', 'OTHER'] as const;
    const salesByMethod = Object.fromEntries(methods.map((method) => [method, Money.zero(currency)])) as Record<PaymentMethod, Money>;
    const tipsByMethod = Object.fromEntries(methods.map((method) => [method, Money.zero(currency)])) as Record<PaymentMethod, Money>;
    const paymentCountByMethod = { CASH: 0, CARD: 0, OTHER: 0 };
    let voidCount = 0;
    for (const payment of payments) {
      if (payment.status === 'VOIDED') {
        voidCount += 1;
        continue;
      }
      if (payment.status !== 'COMPLETED') continue;
      const method = payment.method as PaymentMethod;
      salesByMethod[method] = salesByMethod[method].add(
        Money.fromMinorUnits(payment.amountApplied, payment.currency),
      );
      tipsByMethod[method] = tipsByMethod[method].add(
        Money.fromMinorUnits(payment.tipAmount, payment.currency),
      );
      paymentCountByMethod[method] += 1;
    }
    const movementRows = this.db
      .select()
      .from(schema.cashMovements)
      .where(eq(schema.cashMovements.cashSessionId, session.id.toString()))
      .all();
    let cashIn = Money.zero(currency);
    let cashOut = Money.zero(currency);
    for (const movement of movementRows) {
      const amount = Money.fromMinorUnits(movement.amount, movement.currency);
      if (movement.movementType === 'CASH_IN') cashIn = cashIn.add(amount);
      else cashOut = cashOut.add(amount);
    }
    const expectedCash = session.openingFloat
      .add(salesByMethod.CASH)
      .add(tipsByMethod.CASH)
      .add(cashIn)
      .subtract(cashOut);
    return { salesByMethod, tipsByMethod, paymentCountByMethod, cashIn, cashOut, expectedCash, voidCount };
  }

  private mapSession(row: typeof schema.cashSessions.$inferSelect): CashSession {
    return CashSession.rehydrate({
      id: EntityId.fromString(row.id),
      cashRegisterId: EntityId.fromString(row.cashRegisterId),
      tenantId: EntityId.fromString(row.tenantId),
      locationId: EntityId.fromString(row.locationId),
      openingFloat: Money.fromMinorUnits(row.openingFloatAmount, row.currency),
      businessDate: row.businessDate,
      status: row.status as 'OPEN' | 'CLOSED',
      openedAt: new Date(row.openedAt as unknown as number),
      openedBy: EntityId.fromString(row.openedBy),
      closedAt: row.closedAt ? new Date(row.closedAt as unknown as number) : null,
      closedBy: row.closedBy ? EntityId.fromString(row.closedBy) : null,
      closeCommandId: row.closeCommandId,
      expectedCashAtClose:
        row.expectedCashAtCloseAmount === null
          ? null
          : Money.fromMinorUnits(row.expectedCashAtCloseAmount, row.currency),
      countedCash:
        row.countedCashAmount === null
          ? null
          : Money.fromMinorUnits(row.countedCashAmount, row.currency),
      difference:
        row.differenceAmount === null
          ? null
          : Money.fromMinorUnits(row.differenceAmount, row.currency),
      openCommandId: row.openCommandId,
    });
  }

  private mapReport(row: typeof schema.cashReports.$inferSelect): StoredCashReport {
    return {
      id: row.id,
      cashSessionId: row.cashSessionId,
      reportType: row.reportType as 'X' | 'Z',
      snapshot: JSON.parse(row.snapshotJson) as Record<string, unknown>,
      generatedAt: new Date(row.generatedAt as unknown as number),
      generatedBy: row.generatedBy,
      commandId: row.commandId,
    };
  }
}
