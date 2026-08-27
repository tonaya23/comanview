import { calculateBasisPointsHalfUp, Money } from '@comanview/money';
import {
  InvalidCashTenderedError,
  InvalidTipError,
  PaymentCurrencyMismatchError,
  TipsDisabledError,
} from './errors.js';
import type { PaymentMethod, TipSelection } from './types.js';

export interface TipCalculationContext {
  method: PaymentMethod;
  cashTendered: Money | null;
  authoritativeBalanceDue: Money;
}

export function calculateTip(
  amountApplied: Money,
  selection: TipSelection,
  tipsEnabled: boolean,
  context?: TipCalculationContext,
): Money {
  if (selection.type === 'NONE') return Money.zero(amountApplied.currency);
  if (!tipsEnabled) throw new TipsDisabledError();

  if (selection.type === 'FIXED_AMOUNT') {
    if (!Number.isSafeInteger(selection.amount) || selection.amount < 0) {
      throw new InvalidTipError('Fixed tip must be a non-negative safe integer in minor units.');
    }
    return Money.fromMinorUnits(selection.amount, amountApplied.currency);
  }

  if (selection.type === 'REMAINDER') {
    if (!context) throw new InvalidTipError('Remainder tip requires Payment context.');
    if (context.method !== 'CASH') {
      throw new InvalidTipError('Remainder tip is only valid for CASH Payments.');
    }
    if (!context.cashTendered) {
      throw new InvalidCashTenderedError('cash_tendered is required for remainder tip.');
    }
    for (const money of [context.cashTendered, context.authoritativeBalanceDue]) {
      if (money.currency !== amountApplied.currency) {
        throw new PaymentCurrencyMismatchError(amountApplied.currency, money.currency);
      }
    }
    if (!amountApplied.equals(context.authoritativeBalanceDue)) {
      throw new InvalidTipError(
        'Remainder tip requires amount_applied to settle the authoritative balance_due.',
      );
    }
    if (context.cashTendered.lessThan(amountApplied)) {
      throw new InvalidCashTenderedError(
        'cash_tendered must cover amount_applied for remainder tip.',
      );
    }
    return context.cashTendered.subtract(amountApplied);
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
