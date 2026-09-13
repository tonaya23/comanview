import { describe, expect, it } from 'vitest';
import { assertBusinessDate, assertBusinessDayPolicyChangeAllowed, resolveBusinessDate } from '../BusinessDayPolicy.js';

describe('Edge business day policy', () => {
  const policy = { operationalTimezone: 'America/New_York', rollover: '04:00', version: 1 };
  it('keeps the previous operational date across local midnight', () => {
    expect(resolveBusinessDate(policy, new Date('2026-01-02T05:01:00Z'))).toBe('2026-01-01');
    expect(resolveBusinessDate(policy, new Date('2026-01-02T08:59:59Z'))).toBe('2026-01-01');
    expect(resolveBusinessDate(policy, new Date('2026-01-02T09:00:00Z'))).toBe('2026-01-02');
  });
  it('chooses first occurrence of a repeated rollover and never goes backwards', () => {
    const repeated = { ...policy, rollover: '01:30' };
    expect(resolveBusinessDate(repeated, new Date('2026-11-01T05:29:59Z'))).toBe('2026-10-31');
    for (const instant of ['05:30:00', '06:00:00', '06:29:59', '06:30:00'])
      expect(resolveBusinessDate(repeated, new Date(`2026-11-01T${instant}Z`))).toBe('2026-11-01');
  });
  it('uses the first real local instant after a missing rollover', () => {
    const gap = { ...policy, rollover: '02:30' };
    expect(resolveBusinessDate(gap, new Date('2026-03-08T06:59:59Z'))).toBe('2026-03-07');
    expect(resolveBusinessDate(gap, new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08');
  });
  it('handles non-hour DST transitions and non-integer-hour offsets', () => {
    expect(resolveBusinessDate({ ...policy, operationalTimezone: 'Australia/Lord_Howe', rollover: '02:15' },
      new Date('2026-10-03T15:30:00Z'))).toBe('2026-10-04');
    expect(resolveBusinessDate({ ...policy, operationalTimezone: 'Asia/Kathmandu', rollover: '00:00' },
      new Date('2026-01-01T18:15:00Z'))).toBe('2026-01-02');
  });
  it('does not let a submitted browser date override the Edge', () => {
    const now = new Date('2026-01-02T05:01:00Z');
    expect(() => assertBusinessDate(policy, now, '2026-01-02')).toThrow('BUSINESS_DATE_MISMATCH');
    expect(assertBusinessDate(policy, now)).toBe('2026-01-01');
  });
  it('requires explicit valid timezone and rollover', () => {
    expect(() => resolveBusinessDate({ ...policy, operationalTimezone: 'wrong/zone' }, new Date())).toThrow('TIMEZONE_INVALID');
    expect(() => resolveBusinessDate({ ...policy, rollover: '24:00' }, new Date())).toThrow('BUSINESS_DAY_POLICY_REQUIRED');
  });
  it('blocks policy changes with either kind of open obligation', () => {
    expect(() => assertBusinessDayPolicyChangeAllowed(1, 0)).toThrow('BUSINESS_DAY_POLICY_IN_USE');
    expect(() => assertBusinessDayPolicyChangeAllowed(0, 1)).toThrow('BUSINESS_DAY_POLICY_IN_USE');
    expect(() => assertBusinessDayPolicyChangeAllowed(0, 0)).not.toThrow();
  });
});
