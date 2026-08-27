import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  EntityId,
  KdsInconsistentTicketStateError,
  resolveKdsTransition,
  type KdsTransitionTarget,
  type OrderItemPrepStatus,
} from '@comanview/domain';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface KdsStationView {
  stationId: string;
  name: string;
}

export interface KdsTicketItemView {
  orderItemId: string;
  quantity: number;
  productName: string;
  modifiers: Array<{ modifierOptionId: string; name: string }>;
  specialInstructions: string | null;
  prepStatus: OrderItemPrepStatus;
}

export interface KdsTicketView {
  ticketId: string;
  orderId: string;
  orderNumber: string;
  orderType: 'COUNTER' | 'TABLE' | 'TAKEOUT';
  orderVersion: number;
  locationId: string;
  roundId: string;
  roundNumber: number;
  stationId: string;
  stationName: string;
  status: OrderItemPrepStatus;
  sentAt: Date;
  preparingAt: Date | null;
  readyAt: Date | null;
  items: KdsTicketItemView[];
}

export interface KdsCommandResult {
  eventType: string;
  roundId: string;
  stationId: string;
}

export class KdsTicketPersistenceNotFoundError extends Error {
  constructor(roundId: string, stationId: string) {
    super(`KDS ticket for Round ${roundId} and station ${stationId} was not found.`);
    this.name = 'KdsTicketPersistenceNotFoundError';
  }
}

export class KdsRepository {
  constructor(private readonly db: DB) {}

  listStations(): KdsStationView[] {
    return this.db
      .select({ stationId: schema.stations.id, name: schema.stations.name })
      .from(schema.stations)
      .where(eq(schema.stations.active, true))
      .orderBy(asc(schema.stations.name))
      .all();
  }

  listTickets(stationId: string, status?: OrderItemPrepStatus): KdsTicketView[] {
    const predicate = status
      ? and(
          eq(schema.orderItems.sendStatus, 'SENT'),
          isNotNull(schema.orderItems.roundId),
          eq(schema.orderItems.stationId, stationId),
          eq(schema.orderItems.prepStatus, status),
        )
      : and(
          eq(schema.orderItems.sendStatus, 'SENT'),
          isNotNull(schema.orderItems.roundId),
          eq(schema.orderItems.stationId, stationId),
        );
    const rows = this.db
      .select({
        orderItemId: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        productName: schema.orderItems.productName,
        specialInstructions: schema.orderItems.specialInstructions,
        prepStatus: schema.orderItems.prepStatus,
        prepStartedAt: schema.orderItems.prepStartedAt,
        readyAt: schema.orderItems.readyAt,
        orderId: schema.orders.id,
        orderNumber: schema.orders.orderNumber,
        orderType: schema.orders.orderType,
        orderVersion: schema.orders.version,
        locationId: schema.orders.locationId,
        roundId: schema.rounds.id,
        roundNumber: schema.rounds.roundNumber,
        sentAt: schema.rounds.sentAt,
        stationName: schema.stations.name,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .innerJoin(schema.rounds, eq(schema.rounds.id, schema.orderItems.roundId))
      .innerJoin(schema.stations, eq(schema.stations.id, schema.orderItems.stationId))
      .where(predicate)
      .orderBy(asc(schema.rounds.sentAt), asc(schema.orderItems.id))
      .all();

    if (rows.length === 0) return [];
    const itemIds = rows.map((row) => row.orderItemId);
    const modifierRows = this.db
      .select({
        orderItemId: schema.orderItemModifiers.orderItemId,
        modifierOptionId: schema.orderItemModifiers.modifierOptionId,
        name: schema.orderItemModifiers.name,
      })
      .from(schema.orderItemModifiers)
      .where(inArray(schema.orderItemModifiers.orderItemId, itemIds))
      .orderBy(asc(schema.orderItemModifiers.id))
      .all();
    const modifiersByItem = new Map<string, KdsTicketItemView['modifiers']>();
    for (const modifier of modifierRows) {
      const current = modifiersByItem.get(modifier.orderItemId) ?? [];
      current.push({ modifierOptionId: modifier.modifierOptionId, name: modifier.name });
      modifiersByItem.set(modifier.orderItemId, current);
    }

    const tickets = new Map<string, KdsTicketView>();
    for (const row of rows) {
      const key = `${row.roundId}:${stationId}`;
      const prepStatus = row.prepStatus as OrderItemPrepStatus;
      const existing = tickets.get(key);
      if (existing && existing.status !== prepStatus) {
        throw new KdsInconsistentTicketStateError();
      }
      const ticket =
        existing ??
        ({
          ticketId: key,
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          orderType: row.orderType as KdsTicketView['orderType'],
          orderVersion: row.orderVersion,
          locationId: row.locationId,
          roundId: row.roundId,
          roundNumber: row.roundNumber,
          stationId,
          stationName: row.stationName,
          status: prepStatus,
          sentAt: new Date(row.sentAt as unknown as number),
          preparingAt: row.prepStartedAt ? new Date(row.prepStartedAt as unknown as number) : null,
          readyAt: row.readyAt ? new Date(row.readyAt as unknown as number) : null,
          items: [],
        } satisfies KdsTicketView);
      ticket.items.push({
        orderItemId: row.orderItemId,
        quantity: row.quantity,
        productName: row.productName,
        modifiers: modifiersByItem.get(row.orderItemId) ?? [],
        specialInstructions: row.specialInstructions,
        prepStatus,
      });
      tickets.set(key, ticket);
    }
    return [...tickets.values()];
  }

  getTicket(roundId: string, stationId: string): KdsTicketView | null {
    return this.listTickets(stationId).find((ticket) => ticket.roundId === roundId) ?? null;
  }

  hasProcessedCommand(commandId: string): boolean {
    return Boolean(
      this.db
        .select({ commandId: schema.processedCommands.commandId })
        .from(schema.processedCommands)
        .where(eq(schema.processedCommands.commandId, commandId))
        .get(),
    );
  }

  getCommandResult(commandId: string): KdsCommandResult | null {
    const row = this.db
      .select({ eventType: schema.eventLog.eventType, payload: schema.eventLog.payload })
      .from(schema.eventLog)
      .where(eq(schema.eventLog.commandId, commandId))
      .get();
    if (!row || !row.eventType.startsWith('KDS_TICKET_')) return null;
    const payload = JSON.parse(row.payload) as { roundId: string; stationId: string };
    return { eventType: row.eventType, roundId: payload.roundId, stationId: payload.stationId };
  }

  transitionTicket(
    roundId: string,
    stationId: string,
    target: KdsTransitionTarget,
    commandId: string,
    now = new Date(),
  ): boolean {
    return this.db.transaction((tx) => {
      const db = tx as unknown as DB;
      const rows = db
        .select({
          id: schema.orderItems.id,
          orderId: schema.orderItems.orderId,
          prepStatus: schema.orderItems.prepStatus,
        })
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.roundId, roundId),
            eq(schema.orderItems.stationId, stationId),
            eq(schema.orderItems.sendStatus, 'SENT'),
          ),
        )
        .all();
      if (rows.length === 0) throw new KdsTicketPersistenceNotFoundError(roundId, stationId);
      const resolution = resolveKdsTransition(
        rows.map((row) => row.prepStatus as OrderItemPrepStatus),
        target,
      );
      if (resolution === 'NOOP') return false;

      db.update(schema.orderItems)
        .set(
          target === 'PREPARING'
            ? { prepStatus: target, prepStartedAt: now }
            : { prepStatus: target, readyAt: now },
        )
        .where(
          inArray(
            schema.orderItems.id,
            rows.map((row) => row.id),
          ),
        )
        .run();
      db.insert(schema.processedCommands).values({ commandId, processedAt: now }).run();
      db.insert(schema.eventLog)
        .values({
          id: EntityId.generate().toString(),
          eventType: `KDS_TICKET_${target}`,
          aggregateId: rows[0]!.orderId,
          version: target === 'PREPARING' ? 1 : 2,
          payload: JSON.stringify({ roundId, stationId, status: target }),
          occurredAt: now,
          commandId,
          syncStatus: 'PENDING',
        })
        .run();
      return true;
    });
  }
}
