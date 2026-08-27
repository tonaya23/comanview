import type { PaymentMethod } from '@comanview/contracts';
import { minorUnitsToInput, parseMoneyInputToMinorUnits } from './posLogic.js';

export interface CashDenominationPreset {
  majorUnits: string;
  minorUnits: number;
}

export interface CashTenderInputState {
  value: string;
  quickHistory: string[];
  quickInputStarted: boolean;
}

// Default frontend presets. The currency-keyed shape can later be replaced by
// Location/Admin configuration without changing the input behavior or component.
export const DEFAULT_CASH_DENOMINATIONS: Readonly<Record<string, readonly string[]>> = {
  MXN: ['5', '10', '20', '50', '100', '200', '500'],
  USD: ['1', '5', '10', '20', '50', '100'],
  CAD: ['1', '2', '5', '10', '20', '50', '100'],
  EUR: ['1', '2', '5', '10', '20', '50', '100'],
};

export function getCashDenominationPresets(currency: string): CashDenominationPreset[] {
  return (DEFAULT_CASH_DENOMINATIONS[currency] ?? []).map((majorUnits) => {
    const minorUnits = parseMoneyInputToMinorUnits(majorUnits);
    if (minorUnits === null) throw new Error(`Invalid cash denomination preset: ${majorUnits}`);
    return { majorUnits, minorUnits };
  });
}

export function createCashTenderInput(exactMinorUnits: number): CashTenderInputState {
  return {
    value: minorUnitsToInput(exactMinorUnits),
    quickHistory: [],
    quickInputStarted: false,
  };
}

export function applyCashDenomination(
  state: CashTenderInputState,
  denominationMinorUnits: number,
): CashTenderInputState {
  const currentMinorUnits = parseMoneyInputToMinorUnits(state.value) ?? 0;
  const nextMinorUnits = state.quickInputStarted
    ? currentMinorUnits + denominationMinorUnits
    : denominationMinorUnits;
  return {
    value: minorUnitsToInput(nextMinorUnits),
    quickHistory: [...state.quickHistory, state.value],
    quickInputStarted: true,
  };
}

export function undoCashDenomination(state: CashTenderInputState): CashTenderInputState {
  const previous = state.quickHistory.at(-1);
  if (previous === undefined) return state;
  const quickHistory = state.quickHistory.slice(0, -1);
  return {
    value: previous,
    quickHistory,
    quickInputStarted: quickHistory.length > 0,
  };
}

export function setExactCashTender(exactMinorUnits: number): CashTenderInputState {
  return createCashTenderInput(exactMinorUnits);
}

export function setManualCashTender(value: string): CashTenderInputState {
  return { value, quickHistory: [], quickInputStarted: false };
}

export function getCashTenderPreview(
  value: string,
  requiredMinorUnits: number,
  keepChangeAsTip = false,
) {
  const tenderedMinorUnits = parseMoneyInputToMinorUnits(value);
  const isSufficient = tenderedMinorUnits !== null && tenderedMinorUnits >= requiredMinorUnits;
  return {
    tenderedMinorUnits,
    isSufficient,
    shortfallMinorUnits:
      tenderedMinorUnits === null
        ? requiredMinorUnits
        : Math.max(0, requiredMinorUnits - tenderedMinorUnits),
    changeMinorUnits:
      keepChangeAsTip || tenderedMinorUnits === null
        ? 0
        : Math.max(0, tenderedMinorUnits - requiredMinorUnits),
  };
}

export function canConfirmPaymentTender(
  method: PaymentMethod,
  cashTenderIsSufficient: boolean,
): boolean {
  return method !== 'CASH' || cashTenderIsSufficient;
}
