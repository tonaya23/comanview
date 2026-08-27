import { describe, expect, it } from 'vitest';
import { Money } from '@comanview/money';
import { EntityId } from '../../shared/EntityId.js';
import { CashSession } from '../CashSession.js';
import { CashMovement } from '../CashMovement.js';
import { InvalidBusinessDateError, InvalidOpeningFloatError } from '../errors.js';

describe('CashSession', () => {
  const baseInput = {
    cashRegisterId: EntityId.generate(),
    tenantId: EntityId.generate(),
    locationId: EntityId.generate(),
    openingFloat: Money.fromMinorUnits(50000, 'MXN'),
    businessDate: '2026-08-25',
    openedBy: EntityId.generate(),
    commandId: 'open-session-1',
  };

  it('opens with explicit opening_float and business_date', () => {
    const session = CashSession.open(baseInput);
    expect(session.status).toBe('OPEN');
    expect(session.openingFloat.amount).toBe(50000);
    expect(session.businessDate).toBe('2026-08-25');
  });

  it('allows an explicit zero opening_float', () => {
    expect(
      CashSession.open({ ...baseInput, openingFloat: Money.zero('MXN') }).openingFloat.amount,
    ).toBe(0);
  });

  it('rejects negative opening_float and invalid business_date', () => {
    expect(() =>
      CashSession.open({ ...baseInput, openingFloat: Money.fromMinorUnits(-1, 'MXN') }),
    ).toThrow(InvalidOpeningFloatError);
    expect(() => CashSession.open({ ...baseInput, businessDate: '2026-02-30' })).toThrow(
      InvalidBusinessDateError,
    );
  });

  it('closes once with authoritative expected, counted and difference amounts', () => {
    const session = CashSession.open(baseInput);
    session.close({
      countedCash: Money.fromMinorUnits(60500, 'MXN'),
      expectedCash: Money.fromMinorUnits(60000, 'MXN'),
      closedBy: EntityId.generate(),
      commandId: 'close-session-1',
      closedAt: new Date('2026-08-26T03:00:00.000Z'),
    });
    expect(session.status).toBe('CLOSED');
    expect(session.difference?.amount).toBe(500);
    expect(session.businessDate).toBe('2026-08-25');
    expect(() =>
      session.close({
        countedCash: Money.zero('MXN'),
        expectedCash: Money.zero('MXN'),
        closedBy: EntityId.generate(),
        commandId: 'close-session-2',
      }),
    ).toThrow('already CLOSED');
  });

  it('creates exact attributed cash movements and rejects invalid input', () => {
    const movement = CashMovement.create({
      cashSessionId: EntityId.generate(),
      type: 'CASH_IN',
      amount: Money.fromMinorUnits(10000, 'MXN'),
      reason: '  Cambio adicional  ',
      actorUserId: EntityId.generate(),
      commandId: 'movement-1',
    });
    expect(movement.reason).toBe('Cambio adicional');
    expect(movement.amount.amount).toBe(10000);
    expect(() =>
      CashMovement.create({
        cashSessionId: EntityId.generate(),
        type: 'CASH_OUT',
        amount: Money.zero('MXN'),
        reason: '',
        actorUserId: EntityId.generate(),
        commandId: 'movement-2',
      }),
    ).toThrow('greater than zero');
  });
});
