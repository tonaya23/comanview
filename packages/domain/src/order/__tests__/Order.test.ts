import { describe, it, expect } from 'vitest';
import { EntityId } from '../../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ProductSnapshot, ModifierSnapshot } from '../../catalog/Snapshot.js';
import { Order } from '../Order.js';
import {
  OrderNotOpenError,
  OrderItemSentError,
  OrderItemNotFoundError,
  NoDraftItemsError,
  TableAssignmentError,
  OrderBalanceNotZeroError,
  OrderCurrencyMismatchError,
} from '../errors.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

const DEFAULT_CURRENCY = 'MXN';

function makeSnapshot(
  basePriceMinor = 10000,
  currency = DEFAULT_CURRENCY,
  modifiers: ModifierSnapshot[] = [],
): ProductSnapshot {
  return new ProductSnapshot({
    productId: EntityId.generate(),
    productName: 'Burger',
    basePrice: Money.fromMinorUnits(basePriceMinor, currency),
    taxRateBasisPoints: 1600,
    taxCalculationMode: 'TAX_INCLUDED',
    stationId: null,
    modifiers,
  });
}

function makeModifier(deltaMinor: number, currency = DEFAULT_CURRENCY): ModifierSnapshot {
  return new ModifierSnapshot({
    id: EntityId.generate(),
    name: 'Extra Cheese',
    priceDelta: Money.fromMinorUnits(deltaMinor, currency),
  });
}

function makeBaseOrder(
  type: Parameters<typeof Order.create>[0]['orderType'] = 'COUNTER',
  currency = DEFAULT_CURRENCY,
) {
  return Order.create({
    tenantId: EntityId.generate(),
    locationId: EntityId.generate(),
    orderType: type,
    orderChannel: 'POS',
    orderNumber: 'A-001',
    currency,
  });
}

const ZERO = Money.zero(DEFAULT_CURRENCY);

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Order Aggregate — Phase 1D', () => {

  // ── Construction ──────────────────────────────────────────────────────────

  describe('Order creation', () => {
    it('creates an OPEN order with correct identity fields (INV-01, INV-02)', () => {
      const tenantId = EntityId.generate();
      const locationId = EntityId.generate();
      const order = Order.create({
        tenantId,
        locationId,
        orderType: 'COUNTER',
        orderChannel: 'POS',
        orderNumber: 'A-001',
        currency: 'MXN',
      });

      expect(order.status).toBe('OPEN');
      expect(order.tenantId.equals(tenantId)).toBe(true);
      expect(order.locationId.equals(locationId)).toBe(true);
      expect(order.id).toBeDefined();
      expect(order.version).toBe(1);
      expect(order.currency).toBe('MXN');
    });

    it('normalizes currency to uppercase', () => {
      const order = Order.create({
        tenantId: EntityId.generate(),
        locationId: EntityId.generate(),
        orderType: 'COUNTER',
        orderChannel: 'POS',
        orderNumber: 'A-001',
        currency: 'mxn',
      });
      expect(order.currency).toBe('MXN');
    });

    it('emits ORDER_CREATED event on creation', () => {
      const order = makeBaseOrder();
      const created = order.events.find(e => e.eventType === 'ORDER_CREATED');
      expect(created).toBeDefined();
      expect(created?.orderId.equals(order.id)).toBe(true);
    });

    it('creates with TABLE type and tableIds (INV-09)', () => {
      const t1 = EntityId.generate();
      const t2 = EntityId.generate();
      const order = Order.create({
        tenantId: EntityId.generate(),
        locationId: EntityId.generate(),
        orderType: 'TABLE',
        orderChannel: 'WAITER',
        orderNumber: 'T-01',
        currency: 'MXN',
        tableIds: [t1, t2],
      });
      expect(order.orderType).toBe('TABLE');
      expect(order.tableIds).toHaveLength(2);
    });

    it('throws if non-TABLE order is created with tableIds', () => {
      expect(() =>
        Order.create({
          tenantId: EntityId.generate(),
          locationId: EntityId.generate(),
          orderType: 'COUNTER',
          orderChannel: 'POS',
          orderNumber: 'A-001',
          currency: 'MXN',
          tableIds: [EntityId.generate()],
        }),
      ).toThrow(TableAssignmentError);
    });

    it('creates TAKEOUT order via WAITER channel with USD currency', () => {
      const order = Order.create({
        tenantId: EntityId.generate(),
        locationId: EntityId.generate(),
        orderType: 'TAKEOUT',
        orderChannel: 'WAITER',
        orderNumber: 'TO-01',
        currency: 'USD',
      });
      expect(order.orderType).toBe('TAKEOUT');
      expect(order.orderChannel).toBe('WAITER');
      expect(order.currency).toBe('USD');
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────────

  describe('addItem', () => {
    it('adds a DRAFT item and bumps version', () => {
      const order = makeBaseOrder();
      const v0 = order.version;
      const item = order.addItem(makeSnapshot());

      expect(order.items).toHaveLength(1);
      expect(item.isDraft).toBe(true);
      expect(item.roundId).toBeNull();
      expect(order.version).toBe(v0 + 1);
    });

    it('snapshot is frozen — catalog changes cannot affect existing items (INV-04)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(5000));
      const item = order.items[0]!;
      expect(item.snapshot.basePrice.amount).toBe(5000);
    });

    it('emits ITEM_ADDED event', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(), 'cmd-add-1');
      const ev = order.events.find(e => e.eventType === 'ITEM_ADDED');
      expect(ev).toBeDefined();
      expect((ev as any).commandId).toBe('cmd-add-1');
    });

    it('multiple items accumulate correctly', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.addItem(makeSnapshot());
      expect(order.items).toHaveLength(2);
    });

    it('throws when snapshot currency does not match order currency', () => {
      const order = makeBaseOrder('COUNTER', 'MXN');
      const usdSnapshot = makeSnapshot(10000, 'USD');
      expect(() => order.addItem(usdSnapshot)).toThrow(OrderCurrencyMismatchError);
    });

    it('throws when adding to a CLOSED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(() => order.addItem(makeSnapshot())).toThrow(OrderNotOpenError);
    });

    it('throws when adding to a CANCELLED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.cancel();
      expect(() => order.addItem(makeSnapshot())).toThrow(OrderNotOpenError);
    });
  });

  // ── removeItem ────────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('removes a DRAFT item and bumps version', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      const v0 = order.version;
      order.removeItem(item.id);

      expect(order.items).toHaveLength(0);
      expect(order.version).toBe(v0 + 1);
    });

    it('emits ITEM_REMOVED event', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      order.removeItem(item.id, 'cmd-remove-1');
      const ev = order.events.find(e => e.eventType === 'ITEM_REMOVED');
      expect(ev).toBeDefined();
    });

    it('throws when removing a SENT item (INV-05)', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      order.sendDraftItems();
      expect(() => order.removeItem(item.id)).toThrow(OrderItemSentError);
    });

    it('throws when item not found', () => {
      const order = makeBaseOrder();
      expect(() => order.removeItem(EntityId.generate())).toThrow(OrderItemNotFoundError);
    });

    it('throws when removing from CLOSED order (INV-03)', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(() => order.removeItem(item.id)).toThrow(OrderNotOpenError);
    });
  });

  // ── sendDraftItems / Rounds ───────────────────────────────────────────────

  describe('sendDraftItems / Rounds', () => {
    it('sends draft items and creates a Round (INV-06)', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      const round = order.sendDraftItems();

      expect(order.rounds).toHaveLength(1);
      expect(item.isSent).toBe(true);
      expect(item.roundId?.equals(round.id)).toBe(true);
    });

    it('all SENT items belong to exactly one round (INV-06)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.addItem(makeSnapshot());
      const r = order.sendDraftItems();

      for (const item of order.items) {
        expect(item.roundId?.equals(r.id)).toBe(true);
      }
    });

    it('emits ROUND_SENT event', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems('cmd-send-1');
      const ev = order.events.find(e => e.eventType === 'ROUND_SENT');
      expect(ev).toBeDefined();
    });

    it('supports multiple Rounds in the same Order', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      const r1 = order.sendDraftItems();
      order.addItem(makeSnapshot());
      const r2 = order.sendDraftItems();

      expect(order.rounds).toHaveLength(2);
      expect(r1.roundNumber).toBe(1);
      expect(r2.roundNumber).toBe(2);
    });

    it('second round only picks up new DRAFT items, not prior SENT items', () => {
      const order = makeBaseOrder();
      const item1 = order.addItem(makeSnapshot());
      order.sendDraftItems();

      const item2 = order.addItem(makeSnapshot());
      const r2 = order.sendDraftItems();

      expect(item1.roundId?.equals(r2.id)).toBe(false);
      expect(item2.roundId?.equals(r2.id)).toBe(true);
    });

    it('throws when there are no DRAFT items to send', () => {
      const order = makeBaseOrder();
      expect(() => order.sendDraftItems()).toThrow(NoDraftItemsError);
    });

    it('throws when sending from a CLOSED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(() => order.sendDraftItems()).toThrow(OrderNotOpenError);
    });
  });

  // ── close ─────────────────────────────────────────────────────────────────

  describe('close (INV-15)', () => {
    it('closes when balance_due is exactly zero', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      const v0 = order.version;
      order.close(ZERO);

      expect(order.status).toBe('CLOSED');
      expect(order.version).toBe(v0 + 1);
    });

    it('emits ORDER_CLOSED event', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO, 'cmd-close');
      const ev = order.events.find(e => e.eventType === 'ORDER_CLOSED');
      expect(ev).toBeDefined();
    });

    it('throws when balance_due is non-zero (INV-15)', () => {
      const order = makeBaseOrder();
      const nonZeroBalance = Money.fromMinorUnits(5000, 'MXN');
      expect(() => order.close(nonZeroBalance)).toThrow(OrderBalanceNotZeroError);
    });

    it('throws when balance_due currency does not match the order currency', () => {
      const order = makeBaseOrder('COUNTER', 'MXN');
      const usdZeroBalance = Money.zero('USD');
      expect(() => order.close(usdZeroBalance)).toThrow(OrderCurrencyMismatchError);
    });

    it('throws when closing an already CLOSED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(() => order.close(ZERO)).toThrow(OrderNotOpenError);
    });

    it('throws when closing a CANCELLED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.cancel();
      expect(() => order.close(ZERO)).toThrow(OrderNotOpenError);
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('transitions to CANCELLED', () => {
      const order = makeBaseOrder();
      order.cancel();
      expect(order.status).toBe('CANCELLED');
    });

    it('emits ORDER_CANCELLED event', () => {
      const order = makeBaseOrder();
      order.cancel('cmd-cancel');
      const ev = order.events.find(e => e.eventType === 'ORDER_CANCELLED');
      expect(ev).toBeDefined();
    });

    it('throws when cancelling a CLOSED order (INV-03)', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(() => order.cancel()).toThrow(OrderNotOpenError);
    });
  });

  // ── version / logical versioning ──────────────────────────────────────────

  describe('version / logical versioning (INV deferred to Repository)', () => {
    it('starts at version 1', () => {
      expect(makeBaseOrder().version).toBe(1);
    });

    it('increments on addItem', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      expect(order.version).toBe(2);
    });

    it('increments on removeItem', () => {
      const order = makeBaseOrder();
      const item = order.addItem(makeSnapshot());
      order.removeItem(item.id);
      expect(order.version).toBe(3);
    });

    it('increments on sendDraftItems', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      expect(order.version).toBe(3);
    });

    it('increments on close', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems();
      order.close(ZERO);
      expect(order.version).toBe(4);
    });
  });

  // ── updateTables ──────────────────────────────────────────────────────────

  describe('updateTables (INV-09)', () => {
    it('updates table assignments for TABLE order', () => {
      const order = makeBaseOrder('TABLE');
      order.updateTables([EntityId.generate(), EntityId.generate()]);
      expect(order.tableIds).toHaveLength(2);
    });

    it('emits TABLES_UPDATED event', () => {
      const order = makeBaseOrder('TABLE');
      order.updateTables([EntityId.generate()], 'cmd-tables');
      const ev = order.events.find(e => e.eventType === 'TABLES_UPDATED');
      expect(ev).toBeDefined();
    });

    it('throws if non-TABLE order tries to update tables', () => {
      const order = makeBaseOrder('COUNTER');
      expect(() => order.updateTables([EntityId.generate()])).toThrow(TableAssignmentError);
    });

    it('transferring tables replaces previous assignment', () => {
      const order = makeBaseOrder('TABLE');
      const t1 = EntityId.generate();
      order.updateTables([t1]);
      const t2 = EntityId.generate();
      order.updateTables([t2]);

      expect(order.tableIds).toHaveLength(1);
      expect(order.tableIds[0]!.equals(t2)).toBe(true);
    });
  });

  // ── getSubtotal (INV-08) ───────────────────────────────────────────────────

  describe('getSubtotal (INV-08)', () => {
    it('returns zero in the Order currency when no items', () => {
      const order = makeBaseOrder('COUNTER', 'USD');
      const total = order.getSubtotal();
      expect(total.amount).toBe(0);
      expect(total.currency).toBe('USD');
    });

    it('returns zero MXN for a MXN order with no items', () => {
      const order = makeBaseOrder();
      expect(order.getSubtotal().currency).toBe('MXN');
      expect(order.getSubtotal().amount).toBe(0);
    });

    it('calculates single item total', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(10000));
      expect(order.getSubtotal().amount).toBe(10000);
    });

    it('calculates multi-item total using exact Money arithmetic', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(10000));
      order.addItem(makeSnapshot(5000));
      expect(order.getSubtotal().amount).toBe(15000);
    });

    it('includes modifier price deltas in the total', () => {
      const order = makeBaseOrder();
      const modifier = makeModifier(150);
      const snap = makeSnapshot(10000, 'MXN', [modifier]);
      order.addItem(snap);
      // 10000 (base) + 150 (modifier) = 10150
      expect(order.getSubtotal().amount).toBe(10150);
    });

    it('includes both SENT and DRAFT items in total', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(5000));
      order.sendDraftItems();
      order.addItem(makeSnapshot(3000));
      expect(order.getSubtotal().amount).toBe(8000);
    });
  });

  // ── commandId / idempotency preparation (INV-11 deferred) ────────────────

  describe('commandId stored in events (INV-11: deferred to infrastructure)', () => {
    it('stores commandId in ITEM_ADDED event', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot(), 'idempotent-cmd-abc');
      const ev = order.events.find(e => e.eventType === 'ITEM_ADDED');
      expect((ev as any).commandId).toBe('idempotent-cmd-abc');
    });

    it('stores commandId in ROUND_SENT event', () => {
      const order = makeBaseOrder();
      order.addItem(makeSnapshot());
      order.sendDraftItems('idempotent-round-xyz');
      const ev = order.events.find(e => e.eventType === 'ROUND_SENT');
      expect((ev as any).commandId).toBe('idempotent-round-xyz');
    });
  });
});
