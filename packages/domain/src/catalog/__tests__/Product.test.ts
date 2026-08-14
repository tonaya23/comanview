import { describe, it, expect } from 'vitest';
import { EntityId } from '../../shared/EntityId.js';
import { Money } from '@comanview/money';
import { Product } from '../Product.js';
import { TaxProfile } from '../TaxProfile.js';
import { ModifierGroup } from '../ModifierGroup.js';
import { ModifierOption } from '../ModifierOption.js';
import { ProductModifierGroup } from '../ProductModifierGroup.js';
import {
  ProductUnavailableError,
  ProductInactiveError,
  TaxProfileInactiveError,
  ModifierUnavailableError,
  ModifierInactiveError,
  InvalidModifierSelectionError
} from '../errors.js';

describe('Product Domain', () => {
  const createMockIds = () => ({
    productId: EntityId.generate(),
    categoryId: EntityId.generate(),
    taxProfileId: EntityId.generate(),
    stationId: EntityId.generate(),
    modGroupId: EntityId.generate(),
    modOpt1Id: EntityId.generate(),
    modOpt2Id: EntityId.generate(),
  });

  const setupData = () => {
    const ids = createMockIds();

    const taxProfile = new TaxProfile({
      id: ids.taxProfileId,
      name: 'Standard VAT',
      rateBasisPoints: 1600,
      calculationMode: 'TAX_INCLUDED',
      active: true,
    });

    const opt1 = new ModifierOption({
      id: ids.modOpt1Id,
      name: 'Extra Cheese',
      defaultPriceDelta: Money.fromMinorUnits(150, 'MXN'),
      active: true,
      available: true,
      displayOrder: 1,
    });

    const opt2 = new ModifierOption({
      id: ids.modOpt2Id,
      name: 'Bacon',
      defaultPriceDelta: Money.fromMinorUnits(200, 'MXN'),
      active: true,
      available: true,
      displayOrder: 2,
    });

    const modGroup = new ModifierGroup({
      id: ids.modGroupId,
      name: 'Toppings',
      minSelections: 1,
      maxSelections: 2,
      active: true,
      options: [opt1, opt2],
    });

    const pmg = new ProductModifierGroup({
      modifierGroup: modGroup,
      priceDeltaOverrides: new Map([
        // Override bacon price for this product
        [ids.modOpt2Id.toString(), Money.fromMinorUnits(250, 'MXN')]
      ]),
    });

    const product = new Product({
      id: ids.productId,
      categoryId: ids.categoryId,
      name: 'Burger',
      description: 'Classic burger',
      productType: 'STANDARD',
      basePrice: Money.fromMinorUnits(12000, 'MXN'),
      taxProfile,
      stationId: ids.stationId,
      active: true,
      available: true,
      displayOrder: 1,
      sku: 'BURG-01',
      barcode: null,
      modifierGroups: [pmg],
    });

    return { ids, taxProfile, opt1, opt2, modGroup, pmg, product };
  };

  it('creates a valid snapshot with proper selection and price override', () => {
    const { product, ids } = setupData();
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id, ids.modOpt2Id]]
    ]);

    const snapshot = product.createSnapshot(selections);
    
    expect(snapshot.productId.equals(ids.productId)).toBe(true);
    expect(snapshot.productName).toBe('Burger');
    expect(snapshot.basePrice.amount).toBe(12000);
    expect(snapshot.taxRateBasisPoints).toBe(1600);
    expect(snapshot.modifiers).toHaveLength(2);

    const m1 = snapshot.modifiers.find(m => m.id.equals(ids.modOpt1Id));
    expect(m1?.priceDelta.amount).toBe(150); // Default price

    const m2 = snapshot.modifiers.find(m => m.id.equals(ids.modOpt2Id));
    expect(m2?.priceDelta.amount).toBe(250); // Overridden price
  });

  it('throws when product is inactive', () => {
    const { product, ids } = setupData();
    const inactiveProduct = new Product({ ...product, active: false } as any);
    
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id]]
    ]);

    expect(() => inactiveProduct.createSnapshot(selections)).toThrow(ProductInactiveError);
  });

  it('throws when product is unavailable', () => {
    const { product, ids } = setupData();
    const unavailableProduct = new Product({ ...product, available: false } as any);
    
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id]]
    ]);

    expect(() => unavailableProduct.createSnapshot(selections)).toThrow(ProductUnavailableError);
  });

  it('throws when tax profile is inactive', () => {
    const { product, taxProfile, ids } = setupData();
    const inactiveTax = new TaxProfile({ ...taxProfile, active: false } as any);
    const badProduct = new Product({ ...product, taxProfile: inactiveTax } as any);

    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id]]
    ]);

    expect(() => badProduct.createSnapshot(selections)).toThrow(TaxProfileInactiveError);
  });

  it('throws when minSelections rule is violated', () => {
    const { product } = setupData();
    // 0 selections, but minSelections is 1
    const selections = new Map<string, EntityId[]>();

    expect(() => product.createSnapshot(selections)).toThrow(InvalidModifierSelectionError);
  });

  it('throws when maxSelections rule is violated', () => {
    const { product, ids } = setupData();
    // 3 selections, but maxSelections is 2. (We duplicate one ID just for testing the rule limit)
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id, ids.modOpt2Id, ids.modOpt1Id]]
    ]);

    expect(() => product.createSnapshot(selections)).toThrow(InvalidModifierSelectionError);
  });

  it('throws when an option does not exist in the group', () => {
    const { product, ids } = setupData();
    const badOptId = EntityId.generate();
    
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [badOptId]]
    ]);

    expect(() => product.createSnapshot(selections)).toThrow(InvalidModifierSelectionError);
  });

  it('throws when modifier is unavailable', () => {
    const { ids, taxProfile, modGroup } = setupData();
    
    const badOpt = new ModifierOption({
      id: ids.modOpt1Id,
      name: 'Extra Cheese',
      defaultPriceDelta: Money.fromMinorUnits(150, 'MXN'),
      active: true,
      available: false, // 86'd
      displayOrder: 1,
    });

    const modGroup2 = new ModifierGroup({
      ...modGroup,
      options: [badOpt, modGroup.getOption(ids.modOpt2Id)!]
    } as any);

    const pmg = new ProductModifierGroup({
      modifierGroup: modGroup2,
      priceDeltaOverrides: new Map()
    });

    const product = new Product({
      id: ids.productId,
      categoryId: ids.categoryId,
      name: 'Burger',
      description: 'Classic burger',
      productType: 'STANDARD',
      basePrice: Money.fromMinorUnits(12000, 'MXN'),
      taxProfile,
      stationId: ids.stationId,
      active: true,
      available: true,
      displayOrder: 1,
      sku: 'BURG-01',
      barcode: null,
      modifierGroups: [pmg],
    });

    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id]]
    ]);

    expect(() => product.createSnapshot(selections)).toThrow(ModifierUnavailableError);
  });
});
