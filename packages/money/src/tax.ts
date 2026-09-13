import { roundHalfUpToMinorUnits } from './rounding.js';

export type TaxCalculationMode = 'TAX_ADDED' | 'TAX_INCLUDED';

export interface LineTaxAmounts {
  baseMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
}

/** Phase 1W policy: round exactly once per line, after modifiers and quantity. */
export function calculateLineTax(
  lineAmountMinorUnits: number,
  rateBasisPoints: number,
  mode: TaxCalculationMode,
): LineTaxAmounts {
  if (!Number.isSafeInteger(lineAmountMinorUnits) || lineAmountMinorUnits < 0)
    throw new RangeError('Tax line amount must be a non-negative safe integer.');
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0)
    throw new RangeError('Tax rate must be non-negative integer basis points.');
  if (mode !== 'TAX_ADDED' && mode !== 'TAX_INCLUDED')
    throw new RangeError('Tax calculation mode is invalid.');
  const amount = BigInt(lineAmountMinorUnits);
  const rate = BigInt(rateBasisPoints);
  const tax = roundHalfUpToMinorUnits(amount * rate, mode === 'TAX_ADDED' ? 10_000n : 10_000n + rate);
  const total = mode === 'TAX_ADDED' ? lineAmountMinorUnits + tax : lineAmountMinorUnits;
  if (!Number.isSafeInteger(total)) throw new RangeError('Tax line total exceeds safe minor units.');
  return {
    baseMinorUnits: mode === 'TAX_ADDED' ? lineAmountMinorUnits : lineAmountMinorUnits - tax,
    taxMinorUnits: tax,
    totalMinorUnits: total,
  };
}
