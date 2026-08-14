import { EntityId } from '../shared/EntityId.js';

export type TaxCalculationMode = 'TAX_INCLUDED' | 'TAX_ADDED';

export interface TaxProfileProps {
  id: EntityId;
  name: string;
  /** Tax rate in basis points (e.g., 1600 for 16.00%) to avoid floating-point errors */
  rateBasisPoints: number;
  calculationMode: TaxCalculationMode;
  active: boolean;
}

export class TaxProfile {
  constructor(private readonly props: TaxProfileProps) {
    if (!Number.isSafeInteger(props.rateBasisPoints)) {
      throw new Error(`Tax rate must be an integer in basis points (e.g., 1600 for 16.00%). Got ${props.rateBasisPoints}`);
    }
    if (props.rateBasisPoints < 0) {
      throw new Error(`Tax rate cannot be negative. Got ${props.rateBasisPoints}`);
    }
  }

  get id(): EntityId { return this.props.id; }
  get name(): string { return this.props.name; }
  get rateBasisPoints(): number { return this.props.rateBasisPoints; }
  get calculationMode(): TaxCalculationMode { return this.props.calculationMode; }
  get active(): boolean { return this.props.active; }
}
