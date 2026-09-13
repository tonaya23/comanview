import { EntityId } from '../shared/EntityId.js';
import { Money, calculateLineTax } from '@comanview/money';

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
  /** Absent in legacy snapshots: never retroactively activate tax calculation. */
  taxPolicyVersion?: 0 | 1;
  taxProfileId?: EntityId | null;
  taxProfileRevision?: number | null;
  /** Preparation / Routing Station ID (not just a printer, but a logical destination) */
  stationId: EntityId | null;
  modifiers: ModifierSnapshot[];
}

export class ProductSnapshot {
  private readonly props: ProductSnapshotProps;
  constructor(props: ProductSnapshotProps) {
    this.props = { ...props, modifiers: [...props.modifiers] };
    if (props.taxPolicyVersion !== undefined && props.taxPolicyVersion !== 0 && props.taxPolicyVersion !== 1)
      throw new Error('TAX_POLICY_VERSION_INVALID');
    if (props.taxPolicyVersion === 1 && (!props.taxProfileId ||
      !Number.isSafeInteger(props.taxProfileRevision) || (props.taxProfileRevision ?? 0) < 1))
      throw new Error('TAX_PROFILE_REQUIRED');
  }

  get productId(): EntityId { return this.props.productId; }
  get productName(): string { return this.props.productName; }
  get basePrice(): Money { return this.props.basePrice; }
  get taxRateBasisPoints(): number { return this.props.taxRateBasisPoints; }
  get taxCalculationMode(): 'TAX_INCLUDED' | 'TAX_ADDED' { return this.props.taxCalculationMode; }
  get taxPolicyVersion(): 0 | 1 { return this.props.taxPolicyVersion ?? 0; }
  get taxProfileId(): EntityId | null { return this.props.taxProfileId ?? null; }
  get taxProfileRevision(): number | null { return this.props.taxProfileRevision ?? null; }
  get stationId(): EntityId | null { return this.props.stationId; }
  get modifiers(): ReadonlyArray<ModifierSnapshot> { return this.props.modifiers; }

  lineAmounts(quantity: number): { base: Money; tax: Money; total: Money } {
    const modifierTotal = this.modifiers.reduce((sum, m) => sum.add(m.priceDelta), Money.zero(this.basePrice.currency));
    const amount = this.basePrice.add(modifierTotal).multiply(quantity);
    if (this.taxPolicyVersion === 0) return { base: amount, tax: Money.zero(amount.currency), total: amount };
    const tax = calculateLineTax(amount.amount, this.taxRateBasisPoints, this.taxCalculationMode);
    return { base: Money.fromMinorUnits(tax.baseMinorUnits, amount.currency),
      tax: Money.fromMinorUnits(tax.taxMinorUnits, amount.currency),
      total: Money.fromMinorUnits(tax.totalMinorUnits, amount.currency) };
  }

}
