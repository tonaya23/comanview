import { EntityId } from '../shared/EntityId.js';
import { Money } from '@comanview/money';

export interface ModifierSnapshotProps {
  id: EntityId;
  name: string;
  priceDelta: Money;
}

export class ModifierSnapshot {
  constructor(private readonly props: ModifierSnapshotProps) {}

  get id(): EntityId { return this.props.id; }
  get name(): string { return this.props.name; }
  get priceDelta(): Money { return this.props.priceDelta; }
}

export interface ProductSnapshotProps {
  productId: EntityId;
  productName: string;
  basePrice: Money;
  taxRateBasisPoints: number;
  taxCalculationMode: 'TAX_INCLUDED' | 'TAX_ADDED';
  /** Preparation / Routing Station ID (not just a printer, but a logical destination) */
  stationId: EntityId | null;
  modifiers: ModifierSnapshot[];
}

export class ProductSnapshot {
  constructor(private readonly props: ProductSnapshotProps) {}

  get productId(): EntityId { return this.props.productId; }
  get productName(): string { return this.props.productName; }
  get basePrice(): Money { return this.props.basePrice; }
  get taxRateBasisPoints(): number { return this.props.taxRateBasisPoints; }
  get taxCalculationMode(): 'TAX_INCLUDED' | 'TAX_ADDED' { return this.props.taxCalculationMode; }
  get stationId(): EntityId | null { return this.props.stationId; }
  get modifiers(): ReadonlyArray<ModifierSnapshot> { return this.props.modifiers; }
}
