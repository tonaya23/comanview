import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import {
  EntityId,
  Order,
  OrderStatus,
  OrderType,
  OrderChannel,
  OrderItemSendStatus,
  OrderItemPrepStatus,
  RehydrateOrderProps,
  OrderItemProps,
  RoundProps,
  PaymentMethod,
  PaymentStatus,
  PaymentProps,
} from '@comanview/domain';
import { ProductSnapshot, ModifierSnapshot } from '@comanview/domain';
import { Money } from '@comanview/money';

type DB = BetterSQLite3Database<typeof schema>;

/**
 * OrderRepository persists and retrieves the Order Aggregate Root from Edge SQLite.
 *
 * Key design invariants:
 * - All OrderItem snapshots are persisted historically; they are NEVER reconstructed
 *   from the current catalog state.
 * - saveOrder() can also persist event_log entries in the SAME transaction,
 *   enabling the Transactional Outbox pattern (PRD §2.8, §12.23).
 * - The `rehydrate()` factory method on Order is used to reconstitute the aggregate
 *   without emitting domain events.
 */
export class OrderRepository {
  constructor(private readonly db: DB) {}

  /**
   * Check if a command has already been processed (idempotency check).
   */
  hasProcessedCommand(commandId: string): boolean {
    const row = this.db
      .select()
      .from(schema.processedCommands)
      .where(eq(schema.processedCommands.commandId, commandId))
      .get();
    return !!row;
  }

  getProcessedCommandEvent(
    commandId: string,
  ): { aggregateId: string; eventType: string; payload: string } | null {
    const row = this.db
      .select({
        aggregateId: schema.eventLog.aggregateId,
        eventType: schema.eventLog.eventType,
        payload: schema.eventLog.payload,
      })
      .from(schema.eventLog)
      .where(eq(schema.eventLog.commandId, commandId))
      .get();
    return row ?? null;
  }

  getOrderIdByPaymentCommand(commandId: string): EntityId | null {
    const row = this.db
      .select({ orderId: schema.payments.orderId })
      .from(schema.payments)
      .where(eq(schema.payments.commandId, commandId))
      .get();
    return row ? EntityId.fromString(row.orderId) : null;
  }

  /**
   * Upsert an Order and its complete internal state in a single transaction.
   * If emitEvents is true, domain events are appended to the event_log.
   * If commandId is provided, it records the command as processed for idempotency.
   */
  saveOrder(order: Order, emitEvents: boolean = true, commandId?: string): void {
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;

      if (commandId) {
        db.insert(schema.processedCommands)
          .values({ commandId, processedAt: new Date() })
          .onConflictDoNothing()
          .run();
      }

      // 1. Upsert the orders row
      db.insert(schema.orders)
        .values({
          id: order.id.toString(),
          tenantId: order.tenantId.toString(),
          locationId: order.locationId.toString(),
          orderType: order.orderType,
          orderChannel: order.orderChannel,
          orderNumber: order.orderNumber,
          currency: order.currency,
          status: order.status,
          version: order.version,
          createdAt: order.createdAt,
        })
        .onConflictDoUpdate({
          target: schema.orders.id,
          set: {
            status: order.status,
            version: order.version,
          },
        })
        .run();

      // 2. Table assignments — reset and reinsert
      db.delete(schema.orderTableAssignments)
        .where(eq(schema.orderTableAssignments.orderId, order.id.toString()))
        .run();

      for (const tableId of order.tableIds) {
        db.insert(schema.orderTableAssignments)
          .values({ orderId: order.id.toString(), tableId: tableId.toString() })
          .onConflictDoNothing()
          .run();
      }

      // 3. Rounds — insert only new ones (rounds are immutable once created)
      for (const round of order.rounds) {
        db.insert(schema.rounds)
          .values({
            id: round.id.toString(),
            orderId: order.id.toString(),
            roundNumber: round.roundNumber,
            sentAt: round.sentAt,
          })
          .onConflictDoNothing()
          .run();
      }

      // 4. Order items — upsert (status can change: DRAFT → SENT)
      // Remove only DRAFT rows that the aggregate explicitly removed. SENT rows are
      // historical and must never be deleted, even if persistence code receives an
      // inconsistent aggregate.
      const currentItemIds = new Set(order.items.map((item) => item.id.toString()));
      const persistedDraftItems = db
        .select({ id: schema.orderItems.id })
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.orderId, order.id.toString()),
            eq(schema.orderItems.sendStatus, 'DRAFT'),
          ),
        )
        .all();

      for (const persistedItem of persistedDraftItems) {
        if (currentItemIds.has(persistedItem.id)) continue;

        db.delete(schema.orderItemModifiers)
          .where(eq(schema.orderItemModifiers.orderItemId, persistedItem.id))
          .run();
        db.delete(schema.orderItems).where(eq(schema.orderItems.id, persistedItem.id)).run();
      }

      for (const item of order.items) {
        const snap = item.snapshot;
        db.insert(schema.orderItems)
          .values({
            id: item.id.toString(),
            orderId: order.id.toString(),
            productId: snap.productId.toString(),
            productName: snap.productName,
            basePriceAmount: snap.basePrice.amount,
            basePriceCurrency: snap.basePrice.currency,
            taxRateBasisPoints: snap.taxRateBasisPoints,
            taxCalculationMode: snap.taxCalculationMode,
            stationId: snap.stationId?.toString() ?? null,
            quantity: item.quantity,
            sendStatus: item.sendStatus,
            prepStatus: item.prepStatus,
            roundId: item.roundId?.toString() ?? null,
            specialInstructions: item.specialInstructions,
          })
          .onConflictDoUpdate({
            target: schema.orderItems.id,
            set: {
              sendStatus: item.sendStatus,
              prepStatus: item.prepStatus,
              roundId: item.roundId?.toString() ?? null,
              quantity: item.quantity,
              specialInstructions: item.specialInstructions,
            },
          })
          .run();

        // 4a. Modifier snapshots are immutable and are persisted only with the new item.
        // Re-saving an Order (DRAFT → SENT, payments, close) must not duplicate deltas.
        const persistedModifier = db
          .select({ id: schema.orderItemModifiers.id })
          .from(schema.orderItemModifiers)
          .where(eq(schema.orderItemModifiers.orderItemId, item.id.toString()))
          .get();
        if (!persistedModifier) {
          for (const mod of snap.modifiers) {
            db.insert(schema.orderItemModifiers)
              .values({
                id: EntityId.generate().toString(),
                orderItemId: item.id.toString(),
                modifierOptionId: mod.id.toString(),
                name: mod.name,
                priceDeltaAmount: mod.priceDelta.amount,
                priceDeltaCurrency: mod.priceDelta.currency,
              })
              .run();
          }
        }
      }

      // 5. Payments — append history and allow only lifecycle status updates.
      // COMPLETED and VOIDED Payments are never physically deleted.
      for (const payment of order.payments) {
        db.insert(schema.payments)
          .values({
            id: payment.id.toString(),
            orderId: order.id.toString(),
            cashSessionId: payment.cashSessionId.toString(),
            method: payment.method,
            amountAppliedAmount: payment.amountApplied.amount,
            tipAmount: payment.tipAmount.amount,
            currency: payment.amountApplied.currency,
            cashTenderedAmount: payment.cashTendered?.amount ?? null,
            changeGivenAmount: payment.changeGiven.amount,
            status: payment.status,
            externalReference: payment.externalReference,
            commandId: payment.commandId,
            createdAt: payment.createdAt,
            completedAt: payment.completedAt,
            voidedAt: payment.voidedAt,
          })
          .onConflictDoUpdate({
            target: schema.payments.id,
            set: {
              status: payment.status,
              completedAt: payment.completedAt,
              voidedAt: payment.voidedAt,
            },
          })
          .run();
      }

      // 6. Optionally persist domain events to event_log (Transactional Outbox)
      if (emitEvents) {
        for (const event of order.events) {
          db.insert(schema.eventLog)
            .values({
              id: event.eventId.toString(),
              eventType: event.eventType,
              aggregateId: order.id.toString(),
              version: order.version,
              payload: JSON.stringify(event, (_k, v) => (v instanceof EntityId ? v.toString() : v)),
              occurredAt: event.occurredAt,
              commandId: (event as any).commandId ?? null,
              syncStatus: 'PENDING',
            })
            .onConflictDoNothing()
            .run();
        }
      }
    });
  }

  /**
   * Reconstitute the Order aggregate from persistence.
   * Returns null if not found.
   * Historical snapshots are restored exactly — no catalog queries.
   */
  getOrderById(id: EntityId): Order | null {
    const orderRow = this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id.toString()))
      .get();

    if (!orderRow) return null;

    // Table assignments
    const tableRows = this.db
      .select()
      .from(schema.orderTableAssignments)
      .where(eq(schema.orderTableAssignments.orderId, id.toString()))
      .all();

    // Rounds
    const roundRows = this.db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.orderId, id.toString()))
      .all();

    const rounds: RoundProps[] = roundRows.map((r) => ({
      id: EntityId.fromString(r.id),
      roundNumber: r.roundNumber,
      sentAt: new Date(r.sentAt as unknown as number),
    }));

    // Order items + modifier snapshots
    const itemRows = this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id.toString()))
      .all();

    const items: OrderItemProps[] = [];
    for (const itemRow of itemRows) {
      const modRows = this.db
        .select()
        .from(schema.orderItemModifiers)
        .where(eq(schema.orderItemModifiers.orderItemId, itemRow.id))
        .all();

      const modifiers: ModifierSnapshot[] = modRows.map(
        (m) =>
          new ModifierSnapshot({
            id: EntityId.fromString(m.modifierOptionId),
            name: m.name,
            priceDelta: Money.fromMinorUnits(m.priceDeltaAmount, m.priceDeltaCurrency),
          }),
      );

      const snapshot = new ProductSnapshot({
        productId: EntityId.fromString(itemRow.productId),
        productName: itemRow.productName,
        basePrice: Money.fromMinorUnits(itemRow.basePriceAmount, itemRow.basePriceCurrency),
        taxRateBasisPoints: itemRow.taxRateBasisPoints,
        taxCalculationMode: itemRow.taxCalculationMode as ProductSnapshot['taxCalculationMode'],
        stationId: itemRow.stationId ? EntityId.fromString(itemRow.stationId) : null,
        modifiers,
      });

      items.push({
        id: EntityId.fromString(itemRow.id),
        snapshot,
        quantity: itemRow.quantity,
        sendStatus: itemRow.sendStatus as OrderItemSendStatus,
        prepStatus: itemRow.prepStatus as OrderItemPrepStatus,
        roundId: itemRow.roundId ? EntityId.fromString(itemRow.roundId) : null,
        specialInstructions: itemRow.specialInstructions,
      });
    }

    const paymentRows = this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, id.toString()))
      .all();

    const payments: PaymentProps[] = paymentRows.map((payment) => ({
      id: EntityId.fromString(payment.id),
      orderId: EntityId.fromString(payment.orderId),
      cashSessionId: EntityId.fromString(payment.cashSessionId),
      method: payment.method as PaymentMethod,
      amountApplied: Money.fromMinorUnits(payment.amountAppliedAmount, payment.currency),
      tipAmount: Money.fromMinorUnits(payment.tipAmount, payment.currency),
      cashTendered:
        payment.cashTenderedAmount === null
          ? null
          : Money.fromMinorUnits(payment.cashTenderedAmount, payment.currency),
      changeGiven: Money.fromMinorUnits(payment.changeGivenAmount, payment.currency),
      status: payment.status as PaymentStatus,
      externalReference: payment.externalReference,
      commandId: payment.commandId,
      createdAt: new Date(payment.createdAt as unknown as number),
      completedAt: payment.completedAt ? new Date(payment.completedAt as unknown as number) : null,
      voidedAt: payment.voidedAt ? new Date(payment.voidedAt as unknown as number) : null,
    }));

    const rehydrateProps: RehydrateOrderProps = {
      id: EntityId.fromString(orderRow.id),
      tenantId: EntityId.fromString(orderRow.tenantId),
      locationId: EntityId.fromString(orderRow.locationId),
      orderType: orderRow.orderType as OrderType,
      orderChannel: orderRow.orderChannel as OrderChannel,
      orderNumber: orderRow.orderNumber,
      currency: orderRow.currency,
      status: orderRow.status as OrderStatus,
      version: orderRow.version,
      tableIds: tableRows.map((t) => EntityId.fromString(t.tableId)),
      items,
      rounds,
      payments,
      events: [], // Domain events are in event_log; in-memory list starts fresh after rehydration
      createdAt: new Date(orderRow.createdAt as unknown as number),
    };

    return Order.rehydrate(rehydrateProps);
  }
}
