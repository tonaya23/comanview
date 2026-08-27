import { describe, expect, it } from 'vitest';
import {
  applyCashDenomination,
  canConfirmPaymentTender,
  createCashTenderInput,
  getCashDenominationPresets,
  getCashTenderPreview,
  setExactCashTender,
  setManualCashTender,
  undoCashDenomination,
} from './cashTenderInput.js';

describe('cash tender quick input', () => {
  it('starts at the exact required amount and replaces it on the first denomination tap', () => {
    const initial = createCashTenderInput(23_400);
    expect(initial.value).toBe('234.00');

    const firstTap = applyCashDenomination(initial, 20_000);
    expect(firstTap.value).toBe('200.00');
  });

  it('accumulates following taps including a repeated denomination', () => {
    const first = applyCashDenomination(createCashTenderInput(23_400), 20_000);
    const second = applyCashDenomination(first, 5_000);
    const repeated = applyCashDenomination(second, 20_000);
    expect(second.value).toBe('250.00');
    expect(repeated.value).toBe('450.00');
  });

  it('undoes quick taps one by one and disables itself when history is exhausted', () => {
    const exact = createCashTenderInput(23_400);
    const twoHundred = applyCashDenomination(exact, 20_000);
    const twoFifty = applyCashDenomination(twoHundred, 5_000);
    const twoSeventy = applyCashDenomination(twoFifty, 2_000);

    const firstUndo = undoCashDenomination(twoSeventy);
    const secondUndo = undoCashDenomination(firstUndo);
    const thirdUndo = undoCashDenomination(secondUndo);
    expect(firstUndo.value).toBe('250.00');
    expect(secondUndo.value).toBe('200.00');
    expect(thirdUndo).toEqual(exact);
    expect(undoCashDenomination(thirdUndo)).toBe(thirdUndo);
  });

  it('Exacto restores the required amount and clears quick history', () => {
    const changed = applyCashDenomination(createCashTenderInput(23_400), 20_000);
    expect(setExactCashTender(23_400)).toEqual(createCashTenderInput(23_400));
    expect(changed.quickHistory).not.toHaveLength(0);
  });

  it('manual editing becomes current state and resets denomination history', () => {
    const changed = applyCashDenomination(createCashTenderInput(23_400), 20_000);
    const manual = setManualCashTender('300.25');
    expect(manual).toEqual({ value: '300.25', quickHistory: [], quickInputStarted: false });
    expect(applyCashDenomination(manual, 5_000).value).toBe('50.00');
    expect(changed.value).toBe('200.00');
  });

  it('selects data-driven presets per currency with exact minor units', () => {
    expect(getCashDenominationPresets('MXN').map(({ minorUnits }) => minorUnits)).toEqual([
      500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
    ]);
    expect(getCashDenominationPresets('USD').map(({ majorUnits }) => majorUnits)).toEqual([
      '1',
      '5',
      '10',
      '20',
      '50',
      '100',
    ]);
    expect(getCashDenominationPresets('CAD').map(({ majorUnits }) => majorUnits)).toContain('2');
    expect(getCashDenominationPresets('EUR').map(({ majorUnits }) => majorUnits)).toContain('50');
    expect(getCashDenominationPresets('JPY')).toEqual([]);
  });

  it('blocks insufficient CASH, previews exact change, and does not block CARD', () => {
    const insufficient = getCashTenderPreview('200.00', 23_400);
    const sufficient = getCashTenderPreview('250.00', 23_400);
    expect(insufficient).toMatchObject({ isSufficient: false, shortfallMinorUnits: 3_400 });
    expect(sufficient).toMatchObject({ isSufficient: true, changeMinorUnits: 1_600 });
    expect(canConfirmPaymentTender('CASH', insufficient.isSufficient)).toBe(false);
    expect(canConfirmPaymentTender('CASH', sufficient.isSufficient)).toBe(true);
    expect(canConfirmPaymentTender('CARD', false)).toBe(true);
  });

  it('previews zero change when the cash remainder is kept as tip', () => {
    expect(getCashTenderPreview('40.00', 3_200, true)).toMatchObject({
      isSufficient: true,
      changeMinorUnits: 0,
    });
  });
});
