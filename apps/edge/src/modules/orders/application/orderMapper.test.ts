import { describe, expect, it } from 'vitest';
import { EntityId, Order, ProductSnapshot } from '@comanview/domain';
import { Money } from '@comanview/money';
import { OrderSchema } from '@comanview/contracts';
import { mapOrderToResponse } from './orderMapper.js';

describe('authoritative fiscal response', () => {
  it.each(['TAX_ADDED', 'TAX_INCLUDED'] as const)('carries captured policy and rounded components for %s', mode => {
    const order = Order.create({ tenantId: EntityId.generate(), locationId: EntityId.generate(), currency: 'MXN',
      orderNumber: 'TAX', orderChannel: 'POS', orderType: 'COUNTER' });
    order.addItem(new ProductSnapshot({ productId: EntityId.generate(), productName: 'Item',
      basePrice: Money.fromMinorUnits(mode === 'TAX_ADDED' ? 10000 : 11600, 'MXN'),
      taxPolicyVersion: 1, taxProfileId: EntityId.generate(), taxProfileRevision: 4,
      taxRateBasisPoints: 1600, taxCalculationMode: mode, stationId: null, modifiers: [] }));
    const response = OrderSchema.parse(mapOrderToResponse(order));
    expect(response.subtotal.amount).toBe(10000);
    expect(response.taxTotal?.amount).toBe(1600);
    expect(response.total.amount).toBe(11600);
    expect(response.balanceDue.amount).toBe(11600);
    expect(response.items[0]?.lineBase?.amount).toBe(10000);
    expect(response.items[0]?.lineTax?.amount).toBe(1600);
    expect(response.items[0]?.lineTotal?.amount).toBe(11600);
    expect(response.items[0]?.productSnapshot.taxProfileRevision).toBe(4);
    const missingAmounts = structuredClone(response);
    delete missingAmounts.items[0]!.lineTotal;
    expect(OrderSchema.safeParse(missingAmounts).success).toBe(false);
  });
});
