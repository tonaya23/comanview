import { Money } from '@comanview/money';
import { EntityId } from '../shared/EntityId.js';
import { InvalidBusinessDateError, InvalidOpeningFloatError } from './errors.js';

export type CashSessionStatus = 'OPEN' | 'CLOSED';

export interface CashSessionProps {
  id: EntityId;
  cashRegisterId: EntityId;
  tenantId: EntityId;
  locationId: EntityId;
  openingFloat: Money;
  businessDate: string;
  status: CashSessionStatus;
  openedAt: Date;
  openedBy: EntityId;
  closedAt: Date | null;
  openCommandId: string;
}

export interface OpenCashSessionProps {
  cashRegisterId: EntityId;
  tenantId: EntityId;
  locationId: EntityId;
  openingFloat: Money;
  businessDate: string;
  openedBy: EntityId;
  commandId: string;
}

function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class CashSession {
  private constructor(private readonly props: CashSessionProps) {}

  static open(input: OpenCashSessionProps): CashSession {
    if (input.openingFloat.isNegative()) throw new InvalidOpeningFloatError();
    if (!isValidBusinessDate(input.businessDate)) {
      throw new InvalidBusinessDateError(input.businessDate);
    }

    return new CashSession({
      id: EntityId.generate(),
      cashRegisterId: input.cashRegisterId,
      tenantId: input.tenantId,
      locationId: input.locationId,
      openingFloat: input.openingFloat,
      businessDate: input.businessDate,
      status: 'OPEN',
      openedAt: new Date(),
      openedBy: input.openedBy,
      closedAt: null,
      openCommandId: input.commandId,
    });
  }

  static rehydrate(props: CashSessionProps): CashSession {
    return new CashSession(props);
  }

  get id(): EntityId {
    return this.props.id;
  }
  get cashRegisterId(): EntityId {
    return this.props.cashRegisterId;
  }
  get tenantId(): EntityId {
    return this.props.tenantId;
  }
  get locationId(): EntityId {
    return this.props.locationId;
  }
  get openingFloat(): Money {
    return this.props.openingFloat;
  }
  get businessDate(): string {
    return this.props.businessDate;
  }
  get status(): CashSessionStatus {
    return this.props.status;
  }
  get openedAt(): Date {
    return this.props.openedAt;
  }
  get openedBy(): EntityId {
    return this.props.openedBy;
  }
  get closedAt(): Date | null {
    return this.props.closedAt;
  }
  get openCommandId(): string {
    return this.props.openCommandId;
  }
}
