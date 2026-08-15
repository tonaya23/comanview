import { eq } from 'drizzle-orm';
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
} from '@comanview/domain';
import {
  ProductSnapshot,
  ModifierSnapshot,
} from '@comanview/domain';
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
   * Persist an Order (and optionally its domain events to event_log) in a single
   * atomic transaction. Existing order records are replaced (full upsert/replace).
   *
   * @param order   The Order aggregate to persist.
   * @param emitEvents  If true, appended domain events are inserted into event_log.
   */
  saveOrder(order: Order, emitEvents = true): void {
    this.db.transaction((tx) => {
      const db = tx as unknown as DB;

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
          })
          .onConflictDoUpdate({
            target: schema.orderItems.id,
            set: {
              sendStatus: item.sendStatus,
              prepStatus: item.prepStatus,
              roundId: item.roundId?.toString() ?? null,
              quantity: item.quantity,
            },
          })
          .run();

        // 4a. Modifier snapshots — insert only once per item (historical)
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
            .onConflictDoNothing()
            .run();
        }
      }

      // 5. Optionally persist domain events to event_log (Transactional Outbox)
      if (emitEvents) {
        for (const event of order.events) {
          db.insert(schema.eventLog)
            .values({
              id: event.eventId.toString(),
              eventType: event.eventType,
              aggregateId: order.id.toString(),
              version: order.version,
              payload: JSON.stringify(event, (_k, v) =>
                v instanceof EntityId ? v.toString() : v
              ),
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

      const modifiers: ModifierSnapshot[] = modRows.map((m) => new ModifierSnapshot({
        id: EntityId.fromString(m.modifierOptionId),
        name: m.name,
        priceDelta: Money.fromMinorUnits(m.priceDeltaAmount, m.priceDeltaCurrency),
      }));

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
      });
    }

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
      events: [], // Domain events are in event_log; in-memory list starts fresh after rehydration
      createdAt: new Date(orderRow.createdAt as unknown as number),
    };

    return Order.rehydrate(rehydrateProps);
  }
}
