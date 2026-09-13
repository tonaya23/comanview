import { describe, expect, it } from 'vitest';
import { calculateLineTax } from './tax.js';

describe('phase 1W line tax policy', () => {
  it('adds tax using integer basis points', () => {
    expect(calculateLineTax(10_000, 1600, 'TAX_ADDED')).toEqual({
      baseMinorUnits: 10_000, taxMinorUnits: 1600, totalMinorUnits: 11_600,
    });
  });
  it('extracts INCLUDED tax with denominator 10000 + rate', () => {
    expect(calculateLineTax(11_600, 1600, 'TAX_INCLUDED')).toEqual({
      baseMinorUnits: 10_000, taxMinorUnits: 1600, totalMinorUnits: 11_600,
    });
  });
  it('uses HALF_UP, including an exact half for INCLUDED', () => {
    expect(calculateLineTax(5, 1000, 'TAX_ADDED').taxMinorUnits).toBe(1);
    expect(calculateLineTax(3, 10_000, 'TAX_INCLUDED')).toEqual({
      baseMinorUnits: 1, taxMinorUnits: 2, totalMinorUnits: 3,
    });
  });
  it('rounds the complete line rather than each unit or modifier', () => {
    expect(calculateLineTax((1 + 1) * 3, 1600, 'TAX_ADDED').taxMinorUnits).toBe(1);
  });
  it.each(['TAX_ADDED', 'TAX_INCLUDED'] as const)('supports explicit zero tax: %s', mode => {
    expect(calculateLineTax(157, 0, mode)).toEqual({
      baseMinorUnits: 157, taxMinorUnits: 0, totalMinorUnits: 157,
    });
    expect(calculateLineTax(0, 1600, mode).totalMinorUnits).toBe(0);
  });
  it('keeps intermediate multiplication exact above the number safe range', () => {
    expect(calculateLineTax(9_000_000_000_001, 1600, 'TAX_ADDED').taxMinorUnits)
      .toBe(1_440_000_000_000);
  });
  it('rejects invalid values and overflow instead of silently rounding', () => {
    for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => calculateLineTax(amount, 1600, 'TAX_ADDED')).toThrow(RangeError);
    for (const rate of [-1, 1.5, NaN, Infinity])
      expect(() => calculateLineTax(100, rate, 'TAX_ADDED')).toThrow(RangeError);
    expect(() => calculateLineTax(Number.MAX_SAFE_INTEGER, 1, 'TAX_ADDED')).toThrow(RangeError);
  });
});
