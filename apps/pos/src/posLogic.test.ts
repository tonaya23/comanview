import { describe, expect, it } from 'vitest';
import type { CategoryResponse, ProductResponse } from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';
import {
  ALL_CATEGORIES,
  formatMoney,
  getErrorMessage,
  getVisibleCategories,
  getVisibleProducts,
  getLocalBusinessDate,
  minorUnitsToInput,
  parseMoneyInputToMinorUnits,
  percentageAmountHalfUp,
} from './posLogic.js';

const product = (overrides: Partial<ProductResponse>): ProductResponse => ({
  id: '01991a00-0000-7000-8000-000000000101',
  name: 'Hamburguesa',
  description: '',
  productType: 'STANDARD',
  categoryId: '01991a00-0000-7000-8000-000000000001',
  taxProfile: {
    id: '01991a00-0000-7000-8000-000000000010',
    name: 'IVA',
    rateBasisPoints: 1600,
    calculationMode: 'TAX_INCLUDED',
    active: true,
  },
  basePrice: { amount: 12900, currency: 'MXN' },
  stationId: null,
  sku: null,
  barcode: null,
  displayOrder: 10,
  active: true,
  available: true,
  modifierGroups: [],
  ...overrides,
});

describe('POS presentation behavior', () => {
  it('shows active products for the selected category in display order', () => {
    const products = [
      product({ id: '01991a00-0000-7000-8000-000000000102', name: 'Segundo', displayOrder: 20 }),
      product({ id: '01991a00-0000-7000-8000-000000000103', name: 'Oculto', active: false }),
      product({ id: '01991a00-0000-7000-8000-000000000104', name: 'Primero', displayOrder: 1 }),
      product({
        id: '01991a00-0000-7000-8000-000000000105',
        name: 'Otra categoría',
        categoryId: '01991a00-0000-7000-8000-000000000002',
      }),
    ];

    expect(
      getVisibleProducts(products, '01991a00-0000-7000-8000-000000000001').map((item) => item.name),
    ).toEqual(['Primero', 'Segundo']);
    expect(getVisibleProducts(products, ALL_CATEGORIES)).toHaveLength(3);
  });

  it('hides inactive categories', () => {
    const categories: CategoryResponse[] = [
      { id: '01991a00-0000-7000-8000-000000000001', name: 'Alimentos', active: true },
      { id: '01991a00-0000-7000-8000-000000000002', name: 'Retirada', active: false },
    ];

    expect(getVisibleCategories(categories).map((category) => category.name)).toEqual([
      'Alimentos',
    ]);
  });

  it('formats integer minor units without floating-point business calculations', () => {
    expect(formatMoney(12900, 'MXN')).toContain('129.00');
  });

  it('explains an optimistic concurrency conflict in operational language', () => {
    expect(getErrorMessage(new EdgeClientError('technical', 'STALE_ORDER_VERSION', 409))).toContain(
      'cambió en otro dispositivo',
    );
  });

  it('explains that pending DRAFT items must be sent or removed before closing', () => {
    expect(getErrorMessage(new EdgeClientError('technical', 'ORDER_HAS_DRAFT_ITEMS', 409))).toBe(
      'Envía o elimina los productos pendientes antes de cerrar la venta.',
    );
  });

  it('parses money input with exact minor units and rejects excess decimals', () => {
    expect(parseMoneyInputToMinorUnits('10.50')).toBe(1050);
    expect(parseMoneyInputToMinorUnits('10,5')).toBe(1050);
    expect(parseMoneyInputToMinorUnits('10.005')).toBeNull();
    expect(minorUnitsToInput(1050)).toBe('10.50');
  });

  it('previews percentage tips with deterministic HALF_UP integer rounding', () => {
    expect(percentageAmountHalfUp(105, 1000)).toBe(11);
    expect(percentageAmountHalfUp(104, 1000)).toBe(10);
  });

  it('uses an explicit local business date', () => {
    expect(getLocalBusinessDate(new Date(2026, 7, 25, 23, 30))).toBe('2026-08-25');
  });
});
