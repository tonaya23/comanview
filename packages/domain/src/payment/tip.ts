import { calculateBasisPointsHalfUp, Money } from '@comanview/money';
import { InvalidTipError, TipsDisabledError } from './errors.js';
import type { TipSelection } from './types.js';

export function calculateTip(
  amountApplied: Money,
  selection: TipSelection,
  tipsEnabled: boolean,
): Money {
  if (selection.type === 'NONE') return Money.zero(amountApplied.currency);
  if (!tipsEnabled) throw new TipsDisabledError();

  if (selection.type === 'FIXED_AMOUNT') {
    if (!Number.isSafeInteger(selection.amount) || selection.amount < 0) {
      throw new InvalidTipError('Fixed tip must be a non-negative safe integer in minor units.');
    }
    return Money.fromMinorUnits(selection.amount, amountApplied.currency);
  }

  if (
    !Number.isSafeInteger(selection.basisPoints) ||
    selection.basisPoints < 0 ||
    selection.basisPoints > 10_000
  ) {
    throw new InvalidTipError('Tip percentage must be between 0 and 10,000 basis points.');
  }

  return Money.fromMinorUnits(
    calculateBasisPointsHalfUp(amountApplied.amount, selection.basisPoints),
    amountApplied.currency,
  );
}
