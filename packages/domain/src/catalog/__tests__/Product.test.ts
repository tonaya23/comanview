import { describe, it, expect } from 'vitest';
import { EntityId } from '../../shared/EntityId.js';
import { Money } from '@comanview/money';
import { Product, type ProductProps } from '../Product.js';
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
  InvalidModifierSelectionError,
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
        [ids.modOpt2Id.toString(), Money.fromMinorUnits(250, 'MXN')],
      ]),
    });

    const productProps: ProductProps = {
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
    };
    const product = new Product(productProps);

    return { ids, taxProfile, opt1, opt2, modGroup, pmg, product, productProps };
  };

  it('creates a valid snapshot with proper selection and price override', () => {
    const { product, ids } = setupData();
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id, ids.modOpt2Id]],
    ]);

    const snapshot = product.createSnapshot(selections);

    expect(snapshot.productId.equals(ids.productId)).toBe(true);
    expect(snapshot.productName).toBe('Burger');
    expect(snapshot.basePrice.amount).toBe(12000);
    expect(snapshot.taxRateBasisPoints).toBe(1600);
    expect(snapshot.modifiers).toHaveLength(2);

    const m1 = snapshot.modifiers.find((m) => m.id.equals(ids.modOpt1Id));
    expect(m1?.priceDelta.amount).toBe(150); // Default price

    const m2 = snapshot.modifiers.find((m) => m.id.equals(ids.modOpt2Id));
    expect(m2?.priceDelta.amount).toBe(250); // Overridden price
  });

  it('throws when product is inactive', () => {
    const { productProps, ids } = setupData();
    const inactiveProduct = new Product({ ...productProps, active: false });

    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id]]]);

    expect(() => inactiveProduct.createSnapshot(selections)).toThrow(ProductInactiveError);
  });

  it('throws when product is unavailable', () => {
    const { productProps, ids } = setupData();
    const unavailableProduct = new Product({ ...productProps, available: false });

    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id]]]);

    expect(() => unavailableProduct.createSnapshot(selections)).toThrow(ProductUnavailableError);
  });

  it('throws when tax profile is inactive', () => {
    const { productProps, taxProfile, ids } = setupData();
    const inactiveTax = new TaxProfile({
      id: taxProfile.id,
      name: taxProfile.name,
      rateBasisPoints: taxProfile.rateBasisPoints,
      calculationMode: taxProfile.calculationMode,
      active: false,
    });
    const badProduct = new Product({ ...productProps, taxProfile: inactiveTax });

    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id]]]);

    expect(() => badProduct.createSnapshot(selections)).toThrow(TaxProfileInactiveError);
  });

  it('throws when minSelections rule is violated', () => {
    const { product } = setupData();
    // 0 selections, but minSelections is 1
    const selections = new Map<string, EntityId[]>();

    expect(() => product.createSnapshot(selections)).toThrow(InvalidModifierSelectionError);
  });

  it('throws when maxSelections rule is violated', () => {
    const { productProps, modGroup, ids } = setupData();
    const thirdOption = new ModifierOption({
      id: EntityId.generate(),
      name: 'Avocado',
      defaultPriceDelta: Money.fromMinorUnits(180, 'MXN'),
      active: true,
      available: true,
      displayOrder: 3,
    });
    const group = new ModifierGroup({
      id: modGroup.id,
      name: modGroup.name,
      minSelections: 1,
      maxSelections: 2,
      active: true,
      options: [
        modGroup.getOption(ids.modOpt1Id)!,
        modGroup.getOption(ids.modOpt2Id)!,
        thirdOption,
      ],
    });
    const product = new Product({
      ...productProps,
      modifierGroups: [
        new ProductModifierGroup({ modifierGroup: group, priceDeltaOverrides: new Map() }),
      ],
    });
    const selections = new Map<string, EntityId[]>([
      [ids.modGroupId.toString(), [ids.modOpt1Id, ids.modOpt2Id, thirdOption.id]],
    ]);

    expect(() => product.createSnapshot(selections)).toThrow(InvalidModifierSelectionError);
  });

  it('throws when an option does not exist in the group', () => {
    const { product, ids } = setupData();
    const badOptId = EntityId.generate();

    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [badOptId]]]);

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
      id: modGroup.id,
      name: modGroup.name,
      minSelections: modGroup.minSelections,
      maxSelections: modGroup.maxSelections,
      active: modGroup.active,
      options: [badOpt, modGroup.getOption(ids.modOpt2Id)!],
    });

    const pmg = new ProductModifierGroup({
      modifierGroup: modGroup2,
      priceDeltaOverrides: new Map(),
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

    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id]]]);

    expect(() => product.createSnapshot(selections)).toThrow(ModifierUnavailableError);
  });

  it('throws when modifier is inactive', () => {
    const { ids, productProps, modGroup } = setupData();
    const inactiveOption = new ModifierOption({
      id: ids.modOpt1Id,
      name: 'Extra Cheese',
      defaultPriceDelta: Money.fromMinorUnits(150, 'MXN'),
      active: false,
      available: true,
      displayOrder: 1,
    });
    const group = new ModifierGroup({
      id: modGroup.id,
      name: modGroup.name,
      minSelections: 1,
      maxSelections: 2,
      active: true,
      options: [inactiveOption, modGroup.getOption(ids.modOpt2Id)!],
    });
    const product = new Product({
      ...productProps,
      modifierGroups: [
        new ProductModifierGroup({ modifierGroup: group, priceDeltaOverrides: new Map() }),
      ],
    });

    expect(() =>
      product.createSnapshot(
        new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id]]]),
      ),
    ).toThrow(ModifierInactiveError);
  });

  it('rejects duplicate selections and selections for an unrelated group', () => {
    const { product, ids } = setupData();

    expect(() =>
      product.createSnapshot(
        new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt1Id, ids.modOpt1Id]]]),
      ),
    ).toThrow(InvalidModifierSelectionError);
    expect(() =>
      product.createSnapshot(new Map([[EntityId.generate().toString(), [ids.modOpt1Id]]])),
    ).toThrow(InvalidModifierSelectionError);
  });

  it('keeps an existing snapshot historical when current catalog data changes', () => {
    const { product, productProps, ids, modGroup } = setupData();
    const selections = new Map<string, EntityId[]>([[ids.modGroupId.toString(), [ids.modOpt2Id]]]);
    const historical = product.createSnapshot(selections);
    const renamedOption = new ModifierOption({
      id: ids.modOpt2Id,
      name: 'Smoked Bacon',
      defaultPriceDelta: Money.fromMinorUnits(400, 'MXN'),
      active: true,
      available: true,
      displayOrder: 2,
    });
    const currentGroup = new ModifierGroup({
      id: modGroup.id,
      name: modGroup.name,
      minSelections: modGroup.minSelections,
      maxSelections: modGroup.maxSelections,
      active: true,
      options: [modGroup.getOption(ids.modOpt1Id)!, renamedOption],
    });
    const currentProduct = new Product({
      ...productProps,
      name: 'New Burger',
      basePrice: Money.fromMinorUnits(13000, 'MXN'),
      modifierGroups: [
        new ProductModifierGroup({ modifierGroup: currentGroup, priceDeltaOverrides: new Map() }),
      ],
    });
    const current = currentProduct.createSnapshot(selections);

    expect(historical.productName).toBe('Burger');
    expect(historical.basePrice.amount).toBe(12000);
    expect(historical.modifiers[0]).toMatchObject({ name: 'Bacon' });
    expect(historical.modifiers[0]?.priceDelta.amount).toBe(250);
    expect(current.productName).toBe('New Burger');
    expect(current.basePrice.amount).toBe(13000);
    expect(current.modifiers[0]).toMatchObject({ name: 'Smoked Bacon' });
    expect(current.modifiers[0]?.priceDelta.amount).toBe(400);
  });
});
