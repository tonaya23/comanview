import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import {
  CashRegister,
  CashSession,
  CashSessionAlreadyOpenError,
  EntityId,
} from '@comanview/domain';
import { Money } from '@comanview/money';

type DB = BetterSQLite3Database<typeof schema>;

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
      createdAt: new Date(row.createdAt as unknown as number),
    });
  }

  openSession(session: CashSession): void {
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
          })
          .run();

        tx.insert(schema.processedCommands)
          .values({ commandId: session.openCommandId, processedAt: session.openedAt })
          .run();

        const eventId = EntityId.generate();
        tx.insert(schema.eventLog)
          .values({
            id: eventId.toString(),
            eventType: 'CASH_SESSION_OPENED',
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

  calculateExpectedCash(session: CashSession): Money {
    const completedCashPayments = this.db
      .select({ amount: schema.payments.amountAppliedAmount, currency: schema.payments.currency })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.cashSessionId, session.id.toString()),
          eq(schema.payments.method, 'CASH'),
          eq(schema.payments.status, 'COMPLETED'),
        ),
      )
      .all();

    return completedCashPayments.reduce<Money>(
      (total, payment) => total.add(Money.fromMinorUnits(payment.amount, payment.currency)),
      session.openingFloat,
    );
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
      openCommandId: row.openCommandId,
    });
  }
}
