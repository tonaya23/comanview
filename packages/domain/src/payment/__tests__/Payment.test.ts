import { describe, expect, it } from 'vitest';
import { Money } from '@comanview/money';
import { EntityId } from '../../shared/EntityId.js';
import { Payment } from '../Payment.js';
import { calculateTip } from '../tip.js';
import { InvalidCashTenderedError, TipsDisabledError } from '../errors.js';

const orderId = EntityId.generate();
const cashSessionId = EntityId.generate();

describe('Payment', () => {
  it('keeps amount_applied, tendered, change, and tip separate for CASH', () => {
    const payment = Payment.complete({
      orderId,
      cashSessionId,
      method: 'CASH',
      amountApplied: Money.fromMinorUnits(470, 'MXN'),
      tipAmount: Money.fromMinorUnits(20, 'MXN'),
      cashTendered: Money.fromMinorUnits(500, 'MXN'),
      commandId: 'pay-cash-1',
    });

    expect(payment.status).toBe('COMPLETED');
    expect(payment.amountApplied.amount).toBe(470);
    expect(payment.tipAmount.amount).toBe(20);
    expect(payment.cashTendered?.amount).toBe(500);
    expect(payment.changeGiven.amount).toBe(10);
    expect(payment.chargedTotal.amount).toBe(490);
    expect(payment.cashTendered?.amount).toBe(
      payment.amountApplied.amount + payment.tipAmount.amount + payment.changeGiven.amount,
    );
  });

  it('creates CARD without cash fields and keeps the external reference optional', () => {
    const payment = Payment.complete({
      orderId,
      cashSessionId,
      method: 'CARD',
      amountApplied: Money.fromMinorUnits(850, 'MXN'),
      tipAmount: Money.fromMinorUnits(150, 'MXN'),
      externalReference: 'AUTH-123',
      commandId: 'pay-card-1',
    });

    expect(payment.cashTendered).toBeNull();
    expect(payment.changeGiven.amount).toBe(0);
    expect(payment.externalReference).toBe('AUTH-123');
    expect(payment.chargedTotal.amount).toBe(1000);
  });

  it('requires CASH tendered to cover sale plus tip', () => {
    expect(() =>
      Payment.complete({
        orderId,
        cashSessionId,
        method: 'CASH',
        amountApplied: Money.fromMinorUnits(470, 'MXN'),
        tipAmount: Money.fromMinorUnits(30, 'MXN'),
        cashTendered: Money.fromMinorUnits(499, 'MXN'),
        commandId: 'pay-cash-short',
      }),
    ).toThrow(InvalidCashTenderedError);
  });

  it('preserves completed Payment history when voided', () => {
    const payment = Payment.complete({
      orderId,
      cashSessionId,
      method: 'OTHER',
      amountApplied: Money.fromMinorUnits(100, 'MXN'),
      tipAmount: Money.zero('MXN'),
      commandId: 'pay-other-1',
    });

    payment.void();
    expect(payment.status).toBe('VOIDED');
    expect(payment.amountApplied.amount).toBe(100);
    expect(payment.voidedAt).not.toBeNull();
  });
});

describe('tip calculation', () => {
  it('calculates percentage tips in Edge domain using HALF_UP integer arithmetic', () => {
    expect(
      calculateTip(
        Money.fromMinorUnits(105, 'MXN'),
        { type: 'PERCENTAGE', basisPoints: 1000 },
        true,
      ).amount,
    ).toBe(11);
  });

  it('supports fixed tips and rejects them when tips are disabled', () => {
    expect(
      calculateTip(Money.fromMinorUnits(1000, 'MXN'), { type: 'FIXED_AMOUNT', amount: 125 }, true)
        .amount,
    ).toBe(125);
    expect(() =>
      calculateTip(Money.fromMinorUnits(1000, 'MXN'), { type: 'FIXED_AMOUNT', amount: 125 }, false),
    ).toThrow(TipsDisabledError);
  });
});
