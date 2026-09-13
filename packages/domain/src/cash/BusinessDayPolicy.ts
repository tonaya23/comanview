export interface BusinessDayPolicy {
  operationalTimezone: string;
  rollover: string;
  version: number;
}

export class BusinessDayPolicyError extends Error {
  constructor(public readonly code: 'TIMEZONE_INVALID' | 'BUSINESS_DAY_POLICY_REQUIRED' |
    'BUSINESS_DATE_MISMATCH' | 'BUSINESS_DAY_POLICY_IN_USE') { super(code); }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    if (!timeZone.trim() || /^[+-]/.test(timeZone)) throw new Error('IANA timezone required');
    return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch { throw new BusinessDayPolicyError('TIMEZONE_INVALID'); }
}

export function assertBusinessDayPolicy(policy: BusinessDayPolicy): void {
  formatter(policy.operationalTimezone);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.rollover) ||
    !Number.isSafeInteger(policy.version) || policy.version < 1)
    throw new BusinessDayPolicyError('BUSINESS_DAY_POLICY_REQUIRED');
}

function localParts(format: Intl.DateTimeFormat, instant: number): { date: string; time: string } {
  const parts = Object.fromEntries(format.formatToParts(instant).map(p => [p.type, p.value]));
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, time: `${parts['hour']}:${parts['minute']}` };
}

const boundaries = new Map<string, number | null>();
/** Find the first real instant reaching the wall-clock cutoff on the specified date.
 * Scanning UTC in chronological order selects the first overlap occurrence and the
 * first valid minute after a gap. A completely skipped local date has no boundary.
 * Bounded cache avoids repeated work; cache contents are never financial authority.
 */
function boundary(date: string, policy: BusinessDayPolicy, format: Intl.DateTimeFormat): number | null {
  const key = `${policy.operationalTimezone}/${policy.rollover}/${date}`;
  if (boundaries.has(key)) return boundaries.get(key)!;
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  let result: number | null = null;
  for (let t = midnight - 24 * 3_600_000; t <= midnight + 48 * 3_600_000; t += 60_000) {
    const local = localParts(format, t);
    if (local.date === date && local.time >= policy.rollover) { result = t; break; }
  }
  if (boundaries.size >= 128) boundaries.delete(boundaries.keys().next().value!);
  boundaries.set(key, result);
  return result;
}

/** Edge supplies now. Never derive financial dates from a browser date. */
export function resolveBusinessDate(policy: BusinessDayPolicy, now: Date): string {
  assertBusinessDayPolicy(policy);
  if (!Number.isFinite(now.getTime())) throw new BusinessDayPolicyError('BUSINESS_DAY_POLICY_REQUIRED');
  const format = formatter(policy.operationalTimezone);
  let date = localParts(format, now.getTime()).date;
  for (let previous = 0; previous < 4; previous++) {
    const start = boundary(date, policy, format);
    if (start !== null && start <= now.getTime()) return date;
    date = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  throw new BusinessDayPolicyError('BUSINESS_DAY_POLICY_REQUIRED');
}

export function assertBusinessDate(policy: BusinessDayPolicy, now: Date, submitted?: string): string {
  const actual = resolveBusinessDate(policy, now);
  if (submitted !== undefined && submitted !== actual)
    throw new BusinessDayPolicyError('BUSINESS_DATE_MISMATCH');
  return actual;
}

export function assertBusinessDayPolicyChangeAllowed(openOrders: number, openCashSessions: number): void {
  if (openOrders > 0 || openCashSessions > 0)
    throw new BusinessDayPolicyError('BUSINESS_DAY_POLICY_IN_USE');
}
