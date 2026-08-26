import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ModifierGroup } from './ModifierGroup.js';

export interface ProductModifierGroupProps {
  modifierGroup: ModifierGroup;
  /** Product-specific ordering of this group in the configuration flow. */
  displayOrder?: number;
  /**
   * Map from ModifierOption EntityId string to overridden Money.
   */
  priceDeltaOverrides: Map<string, Money>;
}

export class ProductModifierGroup {
  constructor(private readonly props: ProductModifierGroupProps) {}

  get modifierGroup(): ModifierGroup {
    return this.props.modifierGroup;
  }
  get displayOrder(): number {
    return this.props.displayOrder ?? 0;
  }

  public getPriceOverride(optionId: EntityId): Money | undefined {
    return this.props.priceDeltaOverrides.get(optionId.toString());
  }

  public getPriceForOption(optionId: EntityId): Money | undefined {
    const option = this.modifierGroup.getOption(optionId);
    if (!option) return undefined;

    const override = this.getPriceOverride(optionId);
    return override !== undefined ? override : option.defaultPriceDelta;
  }
}
