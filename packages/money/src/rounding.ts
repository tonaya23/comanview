/**
 * Authoritative financial rounding policy for non-negative rational amounts.
 *
 * The calculation stays in integer space through bigint and rounds exactly once,
 * at the final minor-unit boundary. A remainder of exactly one half rounds up.
 * This policy is intentionally reusable by tips and future tax/discount rules
 * when their specifications select HALF_UP rounding.
 */
export function roundHalfUpToMinorUnits(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n) {
    throw new RangeError('Financial rounding numerator must be non-negative.');
  }
  if (denominator <= 0n) {
    throw new RangeError('Financial rounding denominator must be positive.');
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Rounded minor-unit amount exceeds Number.MAX_SAFE_INTEGER.');
  }

  return Number(rounded);
}

export function calculateBasisPointsHalfUp(amountMinorUnits: number, basisPoints: number): number {
  if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits < 0) {
    throw new RangeError('Amount must be a non-negative safe integer in minor units.');
  }
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError('Basis points must be a non-negative safe integer.');
  }

  return roundHalfUpToMinorUnits(BigInt(amountMinorUnits) * BigInt(basisPoints), 10_000n);
}
