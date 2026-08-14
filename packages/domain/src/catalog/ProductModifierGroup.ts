import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';
import { ModifierGroup } from './ModifierGroup.js';

export interface ProductModifierGroupProps {
  modifierGroup: ModifierGroup;
  /**
   * Map from ModifierOption EntityId string to overridden Money.
   */
  priceDeltaOverrides: Map<string, Money>;
}

export class ProductModifierGroup {
  constructor(private readonly props: ProductModifierGroupProps) {}

  get modifierGroup(): ModifierGroup { return this.props.modifierGroup; }
  
  public getPriceForOption(optionId: EntityId): Money | undefined {
    const option = this.modifierGroup.getOption(optionId);
    if (!option) return undefined;

    const override = this.props.priceDeltaOverrides.get(optionId.toString());
    return override !== undefined ? override : option.defaultPriceDelta;
  }
}
