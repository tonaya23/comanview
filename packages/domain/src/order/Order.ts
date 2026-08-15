import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ProductSnapshot } from '../catalog/Snapshot.js';
import { OrderType, OrderChannel, OrderStatus } from './types.js';
import { OrderItem, OrderItemView } from './OrderItem.js';
import { Round } from './Round.js';
import {
  OrderNotOpenError,
  OrderItemSentError,
  OrderItemNotFoundError,
  NoDraftItemsError,
  TableAssignmentError,
  OrderBalanceNotZeroError,
  OrderCurrencyMismatchError,
} from './errors.js';
import {
  AnyOrderEvent,
  OrderCreatedEvent,
  OrderItemAddedEvent,
  OrderItemRemovedEvent,
  RoundSentEvent,
  OrderClosedEvent,
  OrderCancelledEvent,
  TablesUpdatedEvent,
} from './events.js';

export interface CreateOrderProps {
  tenantId: EntityId;
  locationId: EntityId;
  orderType: OrderType;
  orderChannel: OrderChannel;
  /**
   * Human-readable sequential number within the Location.
   * Generated locally by Edge — no Cloud required (INV-13).
   */
  orderNumber: string;
  /**
   * The currency for this Order (e.g. 'MXN', 'USD').
   * V1 uses a single currency per Location; the Order enforces consistency
   * by rejecting snapshots with a different currency.
   */
  currency: string;
  /**
   * For TABLE orders. A single TABLE order may reference multiple tables (INV-09).
   * Cross-order exclusivity (INV-10) is deferred to infrastructure/repository layer.
   */
  tableIds?: EntityId[];
  commandId?: string;
}

export interface OrderProps {
  id: EntityId;
  tenantId: EntityId;
  locationId: EntityId;
  orderType: OrderType;
  orderChannel: OrderChannel;
  orderNumber: string;
  currency: string;
  status: OrderStatus;
  /**
   * Logical version counter. Incremented on every successful mutation.
   *
   * This provides LOGICAL VERSIONING only. It allows callers to detect
   * concurrent modifications by comparing the version they read against
   * the current one before mutating.
   *
   * OPTIMISTIC CONCURRENCY ENFORCEMENT (comparing expectedVersion before
   * applying a command) is the responsibility of the Application Layer
   * and Repository. The domain does not validate expectedVersion itself.
   *
   * @see PRD §7.17
   */
  version: number;
  tableIds: EntityId[];
  items: OrderItem[];
  rounds: Round[];
  events: AnyOrderEvent[];
  createdAt: Date;
}

/**
 * Interface used exclusively for reconstituting an Order from persistence
 * without emitting domain events or changing the version.
 */
export interface RehydrateOrderProps extends Omit<OrderProps, 'items' | 'rounds'> {
  items: Array<import('./OrderItem.js').OrderItemProps>;
  rounds: Array<import('./Round.js').RoundProps>;
}

/**
 * Order is the Aggregate Root for the transactional core of ComanView (§7).
 *
 * Invariants enforced here:
 *   INV-01: tenantId + locationId always present.
 *   INV-02: order_id is a UUID v7 via EntityId.
 *   INV-03: CLOSED/CANCELLED orders reject all mutations.
 *   INV-04: OrderItem snapshots are frozen at creation (ProductSnapshot).
 *   INV-05: SENT items cannot be removed or destructively modified.
 *   INV-06: All SENT items belong to exactly one Round.
 *   INV-08: All totals use exact Money arithmetic.
 *   INV-09: TABLE orders support multiple tableIds.
 *   INV-12: Every mutation emits a domain event (in-memory only; durable history requires Event Log).
 *   INV-15: close() validates zero balance and freezes commercial state permanently.
 *
 * Invariants deferred:
 *   INV-07: Payment → Order link (Payments phase).
 *   INV-10: Mesa exclusivity (Repository layer).
 *   INV-11: Command idempotency enforcement (Infrastructure; commandId present in events for future use).
 *   INV-13: Cloud-independence (Edge infrastructure).
 *   INV-14: RBAC/Audit (Application layer).
 */
export class Order {
  private constructor(private props: OrderProps) {}

  // ─── Static factory ────────────────────────────────────────────────────────

  static create(input: CreateOrderProps): Order {
    if (input.orderType !== 'TABLE' && (input.tableIds ?? []).length > 0) {
      throw new TableAssignmentError(
        `Only TABLE orders can have table assignments. Got type: ${input.orderType}`,
      );
    }

    const id = EntityId.generate();
    const now = new Date();

    const event: OrderCreatedEvent = {
      eventId: EntityId.generate(),
      eventType: 'ORDER_CREATED',
      orderId: id,
      occurredAt: now,
      commandId: input.commandId ?? null,
      orderType: input.orderType,
      orderChannel: input.orderChannel,
      tenantId: input.tenantId,
      locationId: input.locationId,
      tableIds: input.tableIds ?? [],
    };

    return new Order({
      id,
      tenantId: input.tenantId,
      locationId: input.locationId,
      orderType: input.orderType,
      orderChannel: input.orderChannel,
      orderNumber: input.orderNumber,
      currency: input.currency.toUpperCase(),
      status: 'OPEN',
      version: 1,
      tableIds: input.tableIds ?? [],
      items: [],
      rounds: [],
      events: [event],
      createdAt: now,
    });
  }

  /**
   * Reconstitutes an Order from persistence state without generating domain events.
   * This is exclusively for the Repository layer.
   */
  static rehydrate(props: RehydrateOrderProps): Order {
    return new Order({
      ...props,
      items: props.items.map((i) => new OrderItem(i)),
      rounds: props.rounds.map((r) => new Round(r)),
    });
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): EntityId { return this.props.id; }
  get tenantId(): EntityId { return this.props.tenantId; }
  get locationId(): EntityId { return this.props.locationId; }
  get orderType(): OrderType { return this.props.orderType; }
  get orderChannel(): OrderChannel { return this.props.orderChannel; }
  get orderNumber(): string { return this.props.orderNumber; }
  get currency(): string { return this.props.currency; }
  get status(): OrderStatus { return this.props.status; }
  get version(): number { return this.props.version; }
  get tableIds(): ReadonlyArray<EntityId> { return this.props.tableIds; }
  /** Items exposed as the read-only OrderItemView interface (aggregate boundary). */
  get items(): ReadonlyArray<OrderItemView> { return this.props.items; }
  get rounds(): ReadonlyArray<Round> { return this.props.rounds; }
  get events(): ReadonlyArray<AnyOrderEvent> { return this.props.events; }
  get createdAt(): Date { return this.props.createdAt; }

  // ─── Guards ─────────────────────────────────────────────────────────────────

  private assertIsOpen(): void {
    if (this.props.status !== 'OPEN') {
      throw new OrderNotOpenError(this.props.id.toString(), this.props.status);
    }
  }

  private bumpVersion(): void {
    this.props.version += 1;
  }

  private emit(event: AnyOrderEvent): void {
    this.props.events.push(event);
  }

  // ─── Commands ───────────────────────────────────────────────────────────────

  /**
   * Add a ProductSnapshot to the order as a new DRAFT item.
   *
   * Snapshot is frozen at the moment of addition (INV-04).
   * The snapshot's currency must match the Order's currency (single-currency V1 rule).
   */
  addItem(snapshot: ProductSnapshot, commandId?: string): OrderItemView {
    this.assertIsOpen();

    // Single-currency enforcement: reject snapshots with a different currency.
    if (snapshot.basePrice.currency !== this.props.currency) {
      throw new OrderCurrencyMismatchError(
        this.props.id.toString(),
        this.props.currency,
        snapshot.basePrice.currency,
      );
    }

    const item = new OrderItem({
      id: EntityId.generate(),
      snapshot,
      quantity: 1,
      sendStatus: 'DRAFT',
      prepStatus: 'PENDING',
      roundId: null,
    });

    this.props.items.push(item);
    this.bumpVersion();

    const event: OrderItemAddedEvent = {
      eventId: EntityId.generate(),
      eventType: 'ITEM_ADDED',
      orderId: this.id,
      occurredAt: new Date(),
      commandId: commandId ?? null,
      itemId: item.id,
      productName: snapshot.productName,
    };
    this.emit(event);

    return item;
  }

  /**
   * Remove a DRAFT item from the order.
   * SENT items MUST NOT be removed (INV-05).
   */
  removeItem(itemId: EntityId, commandId?: string): void {
    this.assertIsOpen();

    const item = this.props.items.find(i => i.id.equals(itemId));
    if (!item) {
      throw new OrderItemNotFoundError(itemId.toString());
    }
    if (item.isSent) {
      throw new OrderItemSentError(itemId.toString());
    }

    this.props.items = this.props.items.filter(i => !i.id.equals(itemId));
    this.bumpVersion();

    const event: OrderItemRemovedEvent = {
      eventId: EntityId.generate(),
      eventType: 'ITEM_REMOVED',
      orderId: this.id,
      occurredAt: new Date(),
      commandId: commandId ?? null,
      itemId,
    };
    this.emit(event);
  }

  /**
   * Send all current DRAFT items to the kitchen/bar as a new Round.
   * Each item is marked SENT and linked to this round (INV-06).
   * An Order may have multiple rounds (e.g. drinks first, then food).
   */
  sendDraftItems(commandId?: string): Round {
    this.assertIsOpen();

    const draftItems = this.props.items.filter(i => i.isDraft);
    if (draftItems.length === 0) {
      throw new NoDraftItemsError(this.id.toString());
    }

    const round = new Round({
      id: EntityId.generate(),
      roundNumber: this.props.rounds.length + 1,
      sentAt: new Date(),
    });
    this.props.rounds.push(round);

    for (const item of draftItems) {
      item._markAsSent(round.id);
    }

    this.bumpVersion();

    const event: RoundSentEvent = {
      eventId: EntityId.generate(),
      eventType: 'ROUND_SENT',
      orderId: this.id,
      occurredAt: round.sentAt,
      commandId: commandId ?? null,
      roundId: round.id,
      itemIds: draftItems.map(i => i.id),
    };
    this.emit(event);

    return round;
  }

  /**
   * Close the Order, freezing its commercial state (INV-15).
   *
   * The caller (Application Layer) is responsible for computing balance_due
   * (total - paid) and passing it here. The domain enforces that it is zero.
   *
   * This design keeps Payments out of the domain while still upholding
   * the invariant that a non-zero balance_due prevents closure.
   *
   * Once CLOSED, no further mutations are allowed (INV-03).
   *
   * @param balanceDue   Remaining unpaid amount. Must be zero (Money.isZero()).
   * @param commandId    Optional idempotency token.
   */
  close(balanceDue: Money, commandId?: string): void {
    this.assertIsOpen();

    if (balanceDue.currency !== this.props.currency) {
      throw new OrderCurrencyMismatchError(
        this.props.id.toString(),
        this.props.currency,
        balanceDue.currency,
      );
    }

    if (!balanceDue.isZero()) {
      throw new OrderBalanceNotZeroError(
        this.props.id.toString(),
        balanceDue.amount,
        balanceDue.currency,
      );
    }

    this.props.status = 'CLOSED';
    this.bumpVersion();

    const event: OrderClosedEvent = {
      eventId: EntityId.generate(),
      eventType: 'ORDER_CLOSED',
      orderId: this.id,
      occurredAt: new Date(),
      commandId: commandId ?? null,
    };
    this.emit(event);
  }

  /**
   * Cancel the Order.
   * Once CANCELLED, no further mutations are allowed (INV-03).
   */
  cancel(commandId?: string): void {
    this.assertIsOpen();

    this.props.status = 'CANCELLED';
    this.bumpVersion();

    const event: OrderCancelledEvent = {
      eventId: EntityId.generate(),
      eventType: 'ORDER_CANCELLED',
      orderId: this.id,
      occurredAt: new Date(),
      commandId: commandId ?? null,
    };
    this.emit(event);
  }

  /**
   * Update or transfer the table assignments for this Order.
   * Only TABLE orders may have table assignments.
   * Cross-order exclusivity (INV-10) is enforced at the repository layer.
   */
  updateTables(tableIds: EntityId[], commandId?: string): void {
    this.assertIsOpen();

    if (this.props.orderType !== 'TABLE') {
      throw new TableAssignmentError(
        `Cannot assign tables to a ${this.props.orderType} order.`,
      );
    }

    this.props.tableIds = [...tableIds];
    this.bumpVersion();

    const event: TablesUpdatedEvent = {
      eventId: EntityId.generate(),
      eventType: 'TABLES_UPDATED',
      orderId: this.id,
      occurredAt: new Date(),
      commandId: commandId ?? null,
      tableIds,
    };
    this.emit(event);
  }

  // ─── Totals ─────────────────────────────────────────────────────────────────

  /**
   * Commercial subtotal: sum of all item line totals (base price + modifiers × qty).
   * Uses exact integer arithmetic via @comanview/money (INV-08).
   *
   * Returns Money.zero(this.currency) when there are no items.
   * Currency is the Order's declared currency — no MXN hardcode.
   */
  getSubtotal(): Money {
    return this.props.items.reduce(
      (acc, item) => acc.add(item.getLineTotal()),
      Money.zero(this.props.currency),
    );
  }
}
