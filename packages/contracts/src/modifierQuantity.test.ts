import { describe, expect, it } from 'vitest';
import { AddOrderItemRequestSchema, UpdateDraftOrderItemConfigurationRequestSchema } from './order.js';

const id = '10000000-0000-4000-8000-000000000001';
const base = { commandId: 'quantity-command', expectedVersion: 1, productId: id };
describe('modifier quantity commands', () => {
  it('accepts explicit quantity and legacy IDs without inventing client prices', () => {
    const parsed = AddOrderItemRequestSchema.parse({ ...base,
      selectedModifiers: [{ modifierOptionId: id, quantity: 2, priceDelta: 0 }] });
    expect(parsed.selectedModifiers).toEqual([{ modifierOptionId: id, quantity: 2 }]);
    expect(AddOrderItemRequestSchema.safeParse({ ...base, selectedModifierIds: [id] }).success).toBe(true);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s', quantity => {
    expect(AddOrderItemRequestSchema.safeParse({ ...base,
      selectedModifiers: [{ modifierOptionId: id, quantity }] }).success).toBe(false);
  });
  it('rejects duplicates and ambiguous representations on add and explicit draft edit', () => {
    for (const schema of [AddOrderItemRequestSchema, UpdateDraftOrderItemConfigurationRequestSchema]) {
      expect(schema.safeParse({ ...base, selectedModifiers: [
        { modifierOptionId: id, quantity: 1 }, { modifierOptionId: id, quantity: 1 },
      ] }).success).toBe(false);
      expect(schema.safeParse({ ...base, selectedModifierIds: [id],
        selectedModifiers: [{ modifierOptionId: id, quantity: 1 }] }).success).toBe(false);
    }
  });
});
