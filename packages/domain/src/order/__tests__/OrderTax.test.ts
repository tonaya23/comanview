import { describe, expect, it } from 'vitest';
import { Money } from '@comanview/money';
import { EntityId } from '../../shared/EntityId.js';
import { ProductSnapshot } from '../../catalog/Snapshot.js';
import { Order } from '../Order.js';

function snapshot(mode: 'TAX_ADDED' | 'TAX_INCLUDED' = 'TAX_ADDED', version: 0 | 1 = 1, amount = 10000) {
  return new ProductSnapshot({ productId: EntityId.generate(), productName: 'Item', basePrice: Money.fromMinorUnits(amount, 'MXN'),
    taxRateBasisPoints: 1600, taxCalculationMode: mode, taxPolicyVersion: version,
    taxProfileId: EntityId.generate(), taxProfileRevision: 1, stationId: null, modifiers: [] });
}
function order() {
  return Order.create({ tenantId: EntityId.generate(), locationId: EntityId.generate(), currency: 'MXN',
    orderType: 'COUNTER', orderChannel: 'POS', orderNumber: 'TAX-1' });
}
function revised(original: ProductSnapshot, mode: 'TAX_ADDED' | 'TAX_INCLUDED' = 'TAX_ADDED') {
  return new ProductSnapshot({ productId: original.productId, productName: 'Current catalog',
    basePrice: original.basePrice, taxRateBasisPoints: 800, taxCalculationMode: mode, taxPolicyVersion: 1,
    taxProfileId: original.taxProfileId ?? EntityId.generate(), taxProfileRevision: 2, stationId: null, modifiers: [] });
}

describe('frozen tax snapshots in Orders', () => {
  it('ADDED affects total and payable balance, keeping base separate', () => {
    const o = order(); o.addItem(snapshot());
    expect(o.getSubtotal().amount).toBe(10000);
    expect(o.getTaxTotal().amount).toBe(1600);
    expect(o.getTotal().amount).toBe(11600);
    expect(o.getBalanceDue().amount).toBe(11600);
    o.completePayment({ commandId: EntityId.generate().toString(), cashSessionId: EntityId.generate(), method: 'CARD',
      amountApplied: Money.fromMinorUnits(11600, 'MXN'), tipAmount: Money.fromMinorUnits(100, 'MXN') });
    expect(o.getBalanceDue().amount).toBe(0);
    expect(o.getTaxTotal().amount).toBe(1600);
    expect(o.getTipTotal().amount).toBe(100);
  });
  it('INCLUDED extracts exact line base/tax without increasing total', () => {
    const o = order(); o.addItem(snapshot('TAX_INCLUDED', 1, 11600));
    expect([o.getSubtotal().amount, o.getTaxTotal().amount, o.getTotal().amount]).toEqual([10000, 1600, 11600]);
  });
  it('never activates fiscal calculation on legacy snapshots', () => {
    const o = order(); o.addItem(snapshot('TAX_ADDED', 0));
    expect([o.getSubtotal().amount, o.getTaxTotal().amount, o.getTotal().amount]).toEqual([10000, 0, 10000]);
  });
  it('keeps 16% when the catalog changes without an explicit item edit', () => {
    const o = order(), original = snapshot(); const item = o.addItem(original);
    const currentCatalog = revised(original);
    expect(currentCatalog.taxRateBasisPoints).toBe(800);
    o.updateItemSpecialInstructions(item.id, 'solo nota');
    expect(o.items[0]!.snapshot).toBe(original);
    expect(o.getTaxTotal().amount).toBe(1600);
  });
  it('captures 8% and the new revision only after explicit DRAFT reconfiguration', () => {
    const o = order(), original = snapshot(); const item = o.addItem(original);
    const current = revised(original);
    o.updateDraftItemConfiguration(item.id, current, null);
    expect(o.items[0]!.id.equals(item.id)).toBe(true);
    expect(o.items[0]!.snapshot).toBe(current);
    expect(o.items[0]!.snapshot.taxProfileRevision).toBe(2);
    expect([o.getTaxTotal().amount, o.getTotal().amount]).toEqual([800, 10800]);
  });
  it('does not rebuild SENT even after the catalog changes', () => {
    const o = order(), original = snapshot(); const item = o.addItem(original);
    o.sendDraftItems();
    expect(() => o.updateDraftItemConfiguration(item.id, revised(original), null)).toThrow();
    expect(o.items[0]!.snapshot).toBe(original);
    expect(o.getTaxTotal().amount).toBe(1600);
  });
  it('does not reinterpret closed history', () => {
    const o = order(), original = snapshot(); const item = o.addItem(original);
    o.sendDraftItems();
    o.completePayment({ commandId: EntityId.generate().toString(), cashSessionId: EntityId.generate(), method: 'CARD',
      amountApplied: o.getTotal(), tipAmount: Money.zero('MXN') });
    o.close();
    expect(() => o.updateDraftItemConfiguration(item.id, revised(original), null)).toThrow();
    expect(o.getTaxTotal().amount).toBe(1600);
    expect(o.getBalanceDue().amount).toBe(0);
  });
  it('keeps legacy policy until explicit reconfiguration, then uses exactly the captured new policy/mode', () => {
    const o = order(), original = snapshot('TAX_ADDED', 0); const item = o.addItem(original);
    const current = revised(original, 'TAX_INCLUDED');
    expect(o.items[0]!.snapshot.taxPolicyVersion).toBe(0);
    expect(o.getTaxTotal().amount).toBe(0);
    o.updateDraftItemConfiguration(item.id, current, null);
    expect(o.items[0]!.snapshot.taxPolicyVersion).toBe(1);
    expect(o.items[0]!.snapshot.taxCalculationMode).toBe('TAX_INCLUDED');
    expect([o.getSubtotal().amount, o.getTaxTotal().amount, o.getTotal().amount]).toEqual([9259, 741, 10000]);
  });
  it('rejects activated tax without an explicit profile revision', () => {
    expect(() => new ProductSnapshot({ productId: EntityId.generate(), productName: 'Invalid',
      basePrice: Money.fromMinorUnits(1, 'MXN'), taxRateBasisPoints: 0, taxCalculationMode: 'TAX_ADDED',
      taxPolicyVersion: 1, stationId: null, modifiers: [] })).toThrow('TAX_PROFILE_REQUIRED');
  });
});
