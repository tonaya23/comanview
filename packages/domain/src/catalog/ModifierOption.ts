import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';

export interface ModifierOptionProps {
  id: EntityId;
  name: string;
  defaultPriceDelta: Money;
  active: boolean;
  available: boolean;
  displayOrder: number;
}

export class ModifierOption {
  constructor(private readonly props: ModifierOptionProps) {}

  get id(): EntityId { return this.props.id; }
  get name(): string { return this.props.name; }
  get defaultPriceDelta(): Money { return this.props.defaultPriceDelta; }
  get active(): boolean { return this.props.active; }
  get available(): boolean { return this.props.available; }
  get displayOrder(): number { return this.props.displayOrder; }
}
