import { describe, expect, it } from 'vitest';
import { deriveTableOperationalStatus } from './Table.js';

describe('Table operational status', () => {
  it('uses PAYMENT_REQUESTED > READY > OPEN > FREE precedence', () => {
    expect(
      deriveTableOperationalStatus({
        hasActiveOrder: true,
        hasReadyItems: true,
        paymentRequested: true,
      }),
    ).toBe('PAYMENT_REQUESTED');
    expect(
      deriveTableOperationalStatus({
        hasActiveOrder: true,
        hasReadyItems: true,
        paymentRequested: false,
      }),
    ).toBe('READY');
    expect(
      deriveTableOperationalStatus({
        hasActiveOrder: true,
        hasReadyItems: false,
        paymentRequested: false,
      }),
    ).toBe('OPEN');
    expect(
      deriveTableOperationalStatus({
        hasActiveOrder: false,
        hasReadyItems: true,
        paymentRequested: true,
      }),
    ).toBe('FREE');
  });
});
