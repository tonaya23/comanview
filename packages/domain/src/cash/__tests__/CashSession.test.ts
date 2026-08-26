import { describe, expect, it } from 'vitest';
import { Money } from '@comanview/money';
import { EntityId } from '../../shared/EntityId.js';
import { CashSession } from '../CashSession.js';
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
});
