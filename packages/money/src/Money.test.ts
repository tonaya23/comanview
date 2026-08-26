import { describe, it, expect } from 'vitest';
import { Money, CurrencyMismatchError, InvalidMoneyAmountError } from './Money.js';
import { calculateBasisPointsHalfUp, roundHalfUpToMinorUnits } from './rounding.js';

describe('Money', () => {
  it('creates money from minor units safely', () => {
    const money = Money.fromMinorUnits(12550, 'MXN');
    expect(money.amount).toBe(12550);
    expect(money.currency).toBe('MXN');
  });

  it('throws when creating money with floating point minor units', () => {
    expect(() => Money.fromMinorUnits(10.5, 'USD')).toThrow(InvalidMoneyAmountError);
  });

  it('throws when creating money with unsafe integers', () => {
    expect(() => Money.fromMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(
      InvalidMoneyAmountError,
    );
  });

  it('normalizes currency to uppercase', () => {
    const money = Money.fromMinorUnits(100, 'usd');
    expect(money.currency).toBe('USD');
  });

  it('creates zero money', () => {
    const zero = Money.zero('EUR');
    expect(zero.amount).toBe(0);
    expect(zero.currency).toBe('EUR');
    expect(zero.isZero()).toBe(true);
  });

  describe('arithmetic', () => {
    it('adds two amounts of the same currency', () => {
      const a = Money.fromMinorUnits(1000, 'MXN');
      const b = Money.fromMinorUnits(500, 'MXN');
      const result = a.add(b);
      expect(result.amount).toBe(1500);
      expect(result.currency).toBe('MXN');
    });

    it('subtracts two amounts of the same currency', () => {
      const a = Money.fromMinorUnits(1000, 'MXN');
      const b = Money.fromMinorUnits(300, 'MXN');
      const result = a.subtract(b);
      expect(result.amount).toBe(700);
      expect(result.currency).toBe('MXN');
    });

    it('multiplies by an integer', () => {
      const a = Money.fromMinorUnits(150, 'USD');
      const result = a.multiply(3);
      expect(result.amount).toBe(450);
    });

    it('throws when multiplying by a float', () => {
      const a = Money.fromMinorUnits(150, 'USD');
      expect(() => a.multiply(1.5)).toThrow(/Multiplier must be an integer/);
    });

    it('throws CurrencyMismatchError when adding different currencies', () => {
      const mxn = Money.fromMinorUnits(100, 'MXN');
      const usd = Money.fromMinorUnits(100, 'USD');
      expect(() => mxn.add(usd)).toThrow(CurrencyMismatchError);
    });

    it('throws CurrencyMismatchError when subtracting different currencies', () => {
      const mxn = Money.fromMinorUnits(100, 'MXN');
      const usd = Money.fromMinorUnits(100, 'USD');
      expect(() => mxn.subtract(usd)).toThrow(CurrencyMismatchError);
    });
  });

  describe('comparison', () => {
    const a = Money.fromMinorUnits(500, 'USD');
    const b = Money.fromMinorUnits(500, 'USD');
    const c = Money.fromMinorUnits(600, 'USD');
    const mxn = Money.fromMinorUnits(500, 'MXN');

    it('checks equality', () => {
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
      expect(a.equals(mxn)).toBe(false); // different currency
    });

    it('checks greater than', () => {
      expect(c.greaterThan(a)).toBe(true);
      expect(a.greaterThan(c)).toBe(false);
      expect(a.greaterThan(b)).toBe(false);
    });

    it('checks greater than or equal', () => {
      expect(c.greaterThanOrEqual(a)).toBe(true);
      expect(a.greaterThanOrEqual(b)).toBe(true);
      expect(a.greaterThanOrEqual(c)).toBe(false);
    });

    it('checks less than', () => {
      expect(a.lessThan(c)).toBe(true);
      expect(c.lessThan(a)).toBe(false);
      expect(a.lessThan(b)).toBe(false);
    });

    it('checks less than or equal', () => {
      expect(a.lessThanOrEqual(c)).toBe(true);
      expect(a.lessThanOrEqual(b)).toBe(true);
      expect(c.lessThanOrEqual(a)).toBe(false);
    });

    it('throws CurrencyMismatchError on comparison with different currencies', () => {
      expect(() => a.greaterThan(mxn)).toThrow(CurrencyMismatchError);
    });

    it('identifies positive, negative, and zero amounts', () => {
      const positive = Money.fromMinorUnits(1, 'USD');
      const zero = Money.zero('USD');
      const negative = Money.fromMinorUnits(-1, 'USD');

      expect(positive.isPositive()).toBe(true);
      expect(positive.isNegative()).toBe(false);
      expect(positive.isZero()).toBe(false);

      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);
      expect(zero.isZero()).toBe(true);

      expect(negative.isPositive()).toBe(false);
      expect(negative.isNegative()).toBe(true);
      expect(negative.isZero()).toBe(false);
    });
  });

  describe('serialization', () => {
    it('serializes to JSON correctly', () => {
      const money = Money.fromMinorUnits(1234, 'EUR');
      expect(JSON.stringify(money)).toBe('{"amount":1234,"currency":"EUR"}');
    });
  });
});

describe('authoritative HALF_UP financial rounding', () => {
  it('rounds exactly one half minor unit upward without floating point', () => {
    expect(roundHalfUpToMinorUnits(21n, 2n)).toBe(11);
  });

  it('rounds values below one half down and values above one half up', () => {
    expect(roundHalfUpToMinorUnits(104n, 10n)).toBe(10);
    expect(roundHalfUpToMinorUnits(106n, 10n)).toBe(11);
  });

  it('calculates basis points using integer arithmetic and final HALF_UP rounding', () => {
    expect(calculateBasisPointsHalfUp(105, 1000)).toBe(11);
    expect(calculateBasisPointsHalfUp(104, 1000)).toBe(10);
    expect(calculateBasisPointsHalfUp(12_900, 1500)).toBe(1935);
  });

  it('rejects negative or unsafe financial inputs', () => {
    expect(() => roundHalfUpToMinorUnits(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUpToMinorUnits(1n, 0n)).toThrow(RangeError);
    expect(() => calculateBasisPointsHalfUp(-1, 1000)).toThrow(RangeError);
  });
});
