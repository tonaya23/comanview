import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ProductModifierGroup } from './ProductModifierGroup.js';
import { TaxProfile } from './TaxProfile.js';
import { ProductSnapshot, ModifierSnapshot } from './Snapshot.js';
import {
  ProductUnavailableError,
  ProductInactiveError,
  TaxProfileInactiveError,
  ModifierUnavailableError,
  ModifierInactiveError,
  InvalidModifierSelectionError
} from './errors.js';

export type ProductType = 'STANDARD' | 'RECIPE' | 'NON_INVENTORY';

export interface ProductProps {
  id: EntityId;
  categoryId: EntityId;
  name: string;
  description: string;
  productType: ProductType;
  basePrice: Money;
  taxProfile: TaxProfile;
  /** Preparation / Routing Station ID (not just a printer, but a logical destination) */
  stationId: EntityId | null;
  active: boolean;
  available: boolean;
  displayOrder: number;
  sku: string | null;
  barcode: string | null;
  modifierGroups: ProductModifierGroup[];
}

export class Product {
  constructor(private readonly props: ProductProps) {}

  get id(): EntityId { return this.props.id; }
  get categoryId(): EntityId { return this.props.categoryId; }
  get name(): string { return this.props.name; }
  get description(): string { return this.props.description; }
  get productType(): ProductType { return this.props.productType; }
  get basePrice(): Money { return this.props.basePrice; }
  get taxProfile(): TaxProfile { return this.props.taxProfile; }
  get stationId(): EntityId | null { return this.props.stationId; }
  get active(): boolean { return this.props.active; }
  get available(): boolean { return this.props.available; }
  get displayOrder(): number { return this.props.displayOrder; }
  get sku(): string | null { return this.props.sku; }
  get barcode(): string | null { return this.props.barcode; }
  get modifierGroups(): ReadonlyArray<ProductModifierGroup> { return this.props.modifierGroups; }

  /**
   * Generates an immutable snapshot of the product for an order.
   * Validates active/available status and selection rules.
   * 
   * @param selectedOptions Map of ModifierGroup ID -> Array of selected ModifierOption IDs
   */
  public createSnapshot(selectedOptions: Map<string, EntityId[]>): ProductSnapshot {
    if (!this.active) {
      throw new ProductInactiveError(this.id.toString());
    }
    if (!this.available) {
      throw new ProductUnavailableError(this.id.toString());
    }
    if (!this.taxProfile.active) {
      throw new TaxProfileInactiveError(this.taxProfile.id.toString());
    }

    const modifierSnapshots: ModifierSnapshot[] = [];

    for (const pmg of this.modifierGroups) {
      const group = pmg.modifierGroup;
      if (!group.active) {
        // If a group is inactive, it's treated as if it doesn't exist for the product (cannot select from it)
        // But if we passed selections for it, we should probably throw or ignore.
        // Let's assume an inactive group cannot contribute to selections.
        continue;
      }

      const selectionsForGroup = selectedOptions.get(group.id.toString()) || [];

      if (selectionsForGroup.length < group.minSelections) {
        throw new InvalidModifierSelectionError(`Group ${group.name} requires at least ${group.minSelections} selections.`);
      }
      if (selectionsForGroup.length > group.maxSelections) {
        throw new InvalidModifierSelectionError(`Group ${group.name} allows at most ${group.maxSelections} selections.`);
      }

      for (const optionId of selectionsForGroup) {
        const option = group.getOption(optionId);
        if (!option) {
          throw new InvalidModifierSelectionError(`Option ${optionId.toString()} not found in group ${group.name}.`);
        }
        if (!option.active) {
          throw new ModifierInactiveError(option.id.toString());
        }
        if (!option.available) {
          throw new ModifierUnavailableError(option.id.toString());
        }

        const finalPrice = pmg.getPriceForOption(option.id)!;
        modifierSnapshots.push(new ModifierSnapshot({
          id: option.id,
          name: option.name,
          priceDelta: finalPrice,
        }));
      }
    }

    return new ProductSnapshot({
      productId: this.id,
      productName: this.name,
      basePrice: this.basePrice,
      taxRateBasisPoints: this.taxProfile.rateBasisPoints,
      taxCalculationMode: this.taxProfile.calculationMode,
      stationId: this.stationId,
      modifiers: modifierSnapshots
    });
  }
}
