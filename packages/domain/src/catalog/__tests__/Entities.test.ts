import { describe, it, expect } from 'vitest';
import { EntityId } from '../../shared/EntityId.js';
import { Category } from '../Category.js';
import { TaxProfile } from '../TaxProfile.js';
import { ModifierGroup } from '../ModifierGroup.js';

describe('Catalog Entities', () => {
  it('Category activates and deactivates immutably', () => {
    const id = EntityId.generate();
    const cat = new Category({
      id,
      name: 'Drinks',
      displayOrder: 1,
      active: true,
    });

    const inactiveCat = cat.deactivate();
    expect(inactiveCat.active).toBe(false);
    expect(cat.active).toBe(true);

    const activeCat = inactiveCat.activate();
    expect(activeCat.active).toBe(true);
  });

  it('TaxProfile validates negative rates', () => {
    expect(() => {
      new TaxProfile({
        id: EntityId.generate(),
        name: 'Bad Tax',
        rateBasisPoints: -1,
        calculationMode: 'TAX_INCLUDED',
        active: true,
      });
    }).toThrow('Tax rate cannot be negative');
  });

  it('TaxProfile validates non-integer rates', () => {
    expect(() => {
      new TaxProfile({
        id: EntityId.generate(),
        name: 'Bad Tax',
        rateBasisPoints: 16.5, // Not an integer
        calculationMode: 'TAX_INCLUDED',
        active: true,
      });
    }).toThrow('Tax rate must be an integer in basis points');
  });

  it('ModifierGroup validates selection ranges', () => {
    const id = EntityId.generate();

    expect(() => {
      new ModifierGroup({
        id,
        name: 'Group 1',
        minSelections: -1,
        maxSelections: 1,
        active: true,
        options: []
      });
    }).toThrow('minSelections cannot be negative');

    expect(() => {
      new ModifierGroup({
        id,
        name: 'Group 1',
        minSelections: 2,
        maxSelections: 1,
        active: true,
        options: []
      });
    }).toThrow('maxSelections cannot be less than minSelections');
  });
});
