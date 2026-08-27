import { describe, expect, it } from 'vitest';
import type { CategoryResponse, ProductResponse } from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';
import {
  ALL_CATEGORIES,
  canEditDraftItem,
  formatMoney,
  getActiveModifierGroups,
  getConfiguredProductTotal,
  getEffectiveModifierPrice,
  getErrorMessage,
  getVisibleCategories,
  getVisibleProducts,
  getLocalBusinessDate,
  getModifierGroupValidationMessage,
  getSnapshotTotal,
  getUnsatisfiedModifierGroups,
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

  it('explains receipt lifecycle errors in operational language', () => {
    expect(
      getErrorMessage(new EdgeClientError('technical', 'RECEIPT_REQUIRES_CLOSED_ORDER', 409)),
    ).toBe('Cierra la venta antes de generar el recibo.');
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

  it('orders modifier groups and previews authoritative override prices with integers', () => {
    const configured = product({
      modifierGroups: [
        {
          displayOrder: 20,
          modifierGroup: {
            id: '01991a00-0000-7000-8000-000000000402',
            name: 'Extras',
            minSelections: 0,
            maxSelections: 2,
            active: true,
            options: [
              {
                id: '01991a00-0000-7000-8000-000000000421',
                name: 'Queso',
                defaultPriceDelta: { amount: 1500, currency: 'MXN' },
                active: true,
                available: true,
                displayOrder: 10,
              },
            ],
          },
          priceDeltaOverrides: {
            '01991a00-0000-7000-8000-000000000421': { amount: 2000, currency: 'MXN' },
          },
        },
        {
          displayOrder: 10,
          modifierGroup: {
            id: '01991a00-0000-7000-8000-000000000401',
            name: 'Término',
            minSelections: 1,
            maxSelections: 1,
            active: true,
            options: [],
          },
          priceDeltaOverrides: {},
        },
      ],
    });

    expect(
      getActiveModifierGroups(configured).map(({ modifierGroup }) => modifierGroup.name),
    ).toEqual(['Término', 'Extras']);
    expect(
      getEffectiveModifierPrice(
        configured.modifierGroups[0]!,
        '01991a00-0000-7000-8000-000000000421',
      ),
    ).toBe(2000);
    expect(getConfiguredProductTotal(configured, ['01991a00-0000-7000-8000-000000000421'])).toBe(
      14900,
    );
    expect(getUnsatisfiedModifierGroups(configured, [])).toHaveLength(1);
    expect(getModifierGroupValidationMessage(configured.modifierGroups[1]!, [])).toBe(
      'Selecciona 1 opción en Término.',
    );
  });

  it('reports every incomplete required modifier group independently', () => {
    const configured = product({
      modifierGroups: ['Término', 'Tamaño'].map((name, index) => ({
        displayOrder: index,
        modifierGroup: {
          id: `01991a00-0000-7000-8000-00000000050${index}`,
          name,
          minSelections: 1,
          maxSelections: 1,
          active: true,
          options: [],
        },
        priceDeltaOverrides: {},
      })),
    });

    expect(
      getUnsatisfiedModifierGroups(configured, []).map((group) =>
        getModifierGroupValidationMessage(group, []),
      ),
    ).toEqual(['Selecciona 1 opción en Término.', 'Selecciona 1 opción en Tamaño.']);
  });

  it('shows modifier deltas in the historical item total', () => {
    expect(
      getSnapshotTotal({
        basePrice: { amount: 12900 },
        selectedModifiers: [{ priceDelta: { amount: 0 } }, { priceDelta: { amount: 2000 } }],
      }),
    ).toBe(14900);
  });

  it('explains stale unavailable modifier selections operationally', () => {
    expect(
      getErrorMessage(new EdgeClientError('technical', 'MODIFIER_UNAVAILABLE', 409)),
    ).toContain('Actualizamos el catálogo');
  });

  it('allows configuration editing only for DRAFT items', () => {
    expect(canEditDraftItem('DRAFT')).toBe(true);
    expect(canEditDraftItem('SENT')).toBe(false);
    expect(
      getErrorMessage(
        new EdgeClientError('technical', 'ORDER_ITEM_SPECIAL_INSTRUCTIONS_FROZEN', 409),
      ),
    ).toContain('protegida');
  });
});
