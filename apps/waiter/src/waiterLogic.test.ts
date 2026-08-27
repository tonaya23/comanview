import { describe, expect, it } from 'vitest';
import {
  emptyTableCancellationBlocker,
  modifierSelectionError,
  visibleProducts,
} from './waiterLogic.js';

describe('Waiter presentation logic', () => {
  it('shows only active products in the selected category', () => {
    const products = [
      { id: 'a', active: true, categoryId: 'food', displayOrder: 20 },
      { id: 'b', active: false, categoryId: 'food', displayOrder: 10 },
      { id: 'c', active: true, categoryId: 'drink', displayOrder: 1 },
    ] as any;
    expect(visibleProducts(products, 'food').map((product) => product.id)).toEqual(['a']);
  });

  it('searches all active local products by name without depending on the category', () => {
    const products = [
      { id: 'a', name: 'Limonada', active: true, categoryId: 'drink', displayOrder: 20 },
      { id: 'b', name: 'Tacos', active: true, categoryId: 'food', displayOrder: 10 },
    ] as any;
    expect(visibleProducts(products, 'food', 'LIM').map((product) => product.name)).toEqual([
      'Limonada',
    ]);
  });

  it('reports modifier min/max without becoming financial authority', () => {
    const group = {
      modifierGroup: {
        minSelections: 1,
        maxSelections: 1,
        options: [{ id: 'one' }, { id: 'two' }],
      },
    } as any;
    expect(modifierSelectionError(group, [])).toContain('al menos 1');
    expect(modifierSelectionError(group, ['one'])).toBeNull();
    expect(modifierSelectionError(group, ['one', 'two'])).toContain('máximo 1');
  });

  it('explains why simple table cancellation is unavailable', () => {
    const base = {
      status: 'OPEN',
      orderType: 'TABLE',
      items: [],
      rounds: [],
      payments: [],
    } as any;
    expect(emptyTableCancellationBlocker(base)).toBeNull();
    expect(emptyTableCancellationBlocker({ ...base, items: [{ status: 'DRAFT' }] })).toContain(
      'Elimina',
    );
    expect(
      emptyTableCancellationBlocker({
        ...base,
        items: [{ status: 'SENT' }],
        rounds: [{}],
      }),
    ).toContain('comandas enviadas');
    expect(emptyTableCancellationBlocker({ ...base, payments: [{}] })).toContain('pagos');
  });
});
