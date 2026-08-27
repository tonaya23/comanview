import { EntityId } from '../shared/EntityId.js';

export interface CashRegisterProps {
  id: EntityId;
  tenantId: EntityId;
  locationId: EntityId;
  name: string;
  currency: string;
  active: boolean;
  blindCashCount?: boolean;
  createdAt: Date;
}

export class CashRegister {
  constructor(private readonly props: CashRegisterProps) {}

  get id(): EntityId {
    return this.props.id;
  }
  get tenantId(): EntityId {
    return this.props.tenantId;
  }
  get locationId(): EntityId {
    return this.props.locationId;
  }
  get name(): string {
    return this.props.name;
  }
  get currency(): string {
    return this.props.currency;
  }
  get active(): boolean {
    return this.props.active;
  }
  get blindCashCount(): boolean {
    return this.props.blindCashCount ?? true;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
