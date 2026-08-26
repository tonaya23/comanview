import { describe, expect, it } from 'vitest';
import { Money } from '@comanview/money';
import { EntityId } from '../../shared/EntityId.js';
import { ProductSnapshot } from '../../catalog/Snapshot.js';
import { Order } from '../Order.js';
import {
  OrderBalanceNotZeroError,
  OrderHasDraftItemsError,
  OrderPaidAmountExceedsTotalError,
} from '../errors.js';
import { PaymentOverpaymentError } from '../../payment/errors.js';

function makeOrderWithTotal(amount: number) {
  const order = Order.create({
    tenantId: EntityId.generate(),
    locationId: EntityId.generate(),
    orderType: 'COUNTER',
    orderChannel: 'POS',
    orderNumber: 'PAY-1',
    currency: 'MXN',
  });
  const item = order.addItem(
    new ProductSnapshot({
      productId: EntityId.generate(),
      productName: 'Sale item',
      basePrice: Money.fromMinorUnits(amount, 'MXN'),
      taxRateBasisPoints: 1600,
      taxCalculationMode: 'TAX_INCLUDED',
      stationId: null,
      modifiers: [],
    }),
  );
  return { order, item };
}

function completePayment(order: Order, amount: number, method: 'CASH' | 'CARD' = 'CARD') {
  return order.completePayment({
    cashSessionId: EntityId.generate(),
    method,
    amountApplied: Money.fromMinorUnits(amount, 'MXN'),
    tipAmount: Money.zero('MXN'),
    cashTendered: method === 'CASH' ? Money.fromMinorUnits(amount, 'MXN') : null,
    commandId: EntityId.generate().toString(),
  });
}

function addItem(order: Order, amount: number, name = 'Extra item') {
  return order.addItem(
    new ProductSnapshot({
      productId: EntityId.generate(),
      productName: name,
      basePrice: Money.fromMinorUnits(amount, 'MXN'),
      taxRateBasisPoints: 1600,
      taxCalculationMode: 'TAX_INCLUDED',
      stationId: null,
      modifiers: [],
    }),
  );
}

describe('Order Payments', () => {
  it('supports partial and multiple mixed Payments', () => {
    const { order } = makeOrderWithTotal(1000);
    completePayment(order, 400, 'CASH');
    completePayment(order, 600, 'CARD');

    expect(order.payments).toHaveLength(2);
    expect(order.getPaidAmount().amount).toBe(1000);
    expect(order.getBalanceDue().amount).toBe(0);
  });

  it('keeps tip fully separate from paid sale amount and sale balance', () => {
    const { order } = makeOrderWithTotal(12900);
    const payment = order.completePayment({
      cashSessionId: EntityId.generate(),
      method: 'CARD',
      amountApplied: Money.fromMinorUnits(12900, 'MXN'),
      tipAmount: Money.fromMinorUnits(500, 'MXN'),
      commandId: 'tip-payment',
    });

    expect(order.getSubtotal().amount).toBe(12900);
    expect(order.getPaidAmount().amount).toBe(12900);
    expect(order.getTipTotal().amount).toBe(500);
    expect(order.getBalanceDue().amount).toBe(0);
    expect(payment.chargedTotal.amount).toBe(13400);
  });

  it('prevents amount_applied overpayment', () => {
    const { order } = makeOrderWithTotal(500);
    expect(() => completePayment(order, 501)).toThrow(PaymentOverpaymentError);
  });

  it('rejects closing with positive balance even when all items are SENT', () => {
    const { order } = makeOrderWithTotal(1000);
    order.sendDraftItems();
    completePayment(order, 400);
    expect(() => order.close()).toThrow(OrderBalanceNotZeroError);
    expect(order.status).toBe('OPEN');
  });

  it('closes at zero balance when all items are SENT', () => {
    const { order } = makeOrderWithTotal(1000);
    order.sendDraftItems();
    completePayment(order, 1000);
    expect(order.status).toBe('OPEN');
    order.close();
    expect(order.status).toBe('CLOSED');
  });

  it('keeps a fully paid Order OPEN while any item is DRAFT without implicit sending', () => {
    const { order } = makeOrderWithTotal(1000);
    completePayment(order, 1000);
    const versionBeforeClose = order.version;
    const roundsBeforeClose = order.rounds.length;

    expect(order.getBalanceDue().amount).toBe(0);
    expect(() => order.close('rejected-close')).toThrow(OrderHasDraftItemsError);
    expect(order.status).toBe('OPEN');
    expect(order.items[0]?.sendStatus).toBe('DRAFT');
    expect(order.rounds).toHaveLength(roundsBeforeClose);
    expect(order.version).toBe(versionBeforeClose);
    expect(order.events.some((event) => event.eventType === 'ORDER_CLOSED')).toBe(false);
  });

  it('allows closing after a fully paid DRAFT is explicitly sent', () => {
    const { order } = makeOrderWithTotal(1000);
    completePayment(order, 1000);
    expect(() => order.close()).toThrow(OrderHasDraftItemsError);

    order.sendDraftItems('send-after-payment');
    expect(order.items.every((item) => item.sendStatus === 'SENT')).toBe(true);
    order.close('close-after-send');
    expect(order.status).toBe('CLOSED');
  });

  it('allows closing after a later DRAFT is explicitly removed and balance returns to zero', () => {
    const { order } = makeOrderWithTotal(1000);
    order.sendDraftItems();
    completePayment(order, 1000);
    const pendingItem = addItem(order, 200, 'Pending item');

    expect(order.getBalanceDue().amount).toBe(200);
    order.removeItem(pendingItem.id, 'remove-pending-item');
    expect(order.getBalanceDue().amount).toBe(0);
    order.close('close-after-remove');
    expect(order.status).toBe('CLOSED');
  });

  it('only COMPLETED Payments affect paid amount after VOID', () => {
    const { order } = makeOrderWithTotal(1000);
    const payment = completePayment(order, 400);
    order.voidPayment(payment.id, 'void-1');

    expect(order.payments[0]?.status).toBe('VOIDED');
    expect(order.getPaidAmount().amount).toBe(0);
    expect(order.getBalanceDue().amount).toBe(1000);
  });

  it('prevents removing a DRAFT item below already completed paid amount', () => {
    const { order, item } = makeOrderWithTotal(1000);
    completePayment(order, 500);
    expect(() => order.removeItem(item.id)).toThrow(OrderPaidAmountExceedsTotalError);
  });

  it('allows adding new items after partial payment', () => {
    const { order } = makeOrderWithTotal(1000);
    completePayment(order, 400);
    order.addItem(
      new ProductSnapshot({
        productId: EntityId.generate(),
        productName: 'Extra item',
        basePrice: Money.fromMinorUnits(200, 'MXN'),
        taxRateBasisPoints: 1600,
        taxCalculationMode: 'TAX_INCLUDED',
        stationId: null,
        modifiers: [],
      }),
    );
    expect(order.getBalanceDue().amount).toBe(800);
  });

  it('supports partial Payments followed by new items and later Rounds', () => {
    const { order } = makeOrderWithTotal(1000);
    order.sendDraftItems('first-round');
    completePayment(order, 400, 'CASH');

    addItem(order, 200, 'Later item');
    expect(order.getBalanceDue().amount).toBe(800);
    expect(order.items.some((item) => item.sendStatus === 'DRAFT')).toBe(true);
    order.sendDraftItems('second-round');
    completePayment(order, 800, 'CARD');

    expect(order.rounds).toHaveLength(2);
    expect(order.items.every((item) => item.sendStatus === 'SENT')).toBe(true);
    expect(order.getBalanceDue().amount).toBe(0);
    order.close();
    expect(order.status).toBe('CLOSED');
  });
});
