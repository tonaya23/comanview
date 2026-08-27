import { Money } from '@comanview/money';
import { EntityId } from '../shared/EntityId.js';
import {
  CashSessionAlreadyClosedError,
  InvalidBusinessDateError,
  InvalidCashCountError,
  InvalidOpeningFloatError,
} from './errors.js';

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
  closedBy: EntityId | null;
  closeCommandId: string | null;
  expectedCashAtClose: Money | null;
  countedCash: Money | null;
  difference: Money | null;
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
      closedBy: null,
      closeCommandId: null,
      expectedCashAtClose: null,
      countedCash: null,
      difference: null,
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
  get closedBy(): EntityId | null {
    return this.props.closedBy;
  }
  get closeCommandId(): string | null {
    return this.props.closeCommandId;
  }
  get expectedCashAtClose(): Money | null {
    return this.props.expectedCashAtClose;
  }
  get countedCash(): Money | null {
    return this.props.countedCash;
  }
  get difference(): Money | null {
    return this.props.difference;
  }
  get openCommandId(): string {
    return this.props.openCommandId;
  }

  close(input: {
    countedCash: Money;
    expectedCash: Money;
    closedBy: EntityId;
    commandId: string;
    closedAt?: Date;
  }): void {
    if (this.props.status !== 'OPEN') throw new CashSessionAlreadyClosedError();
    if (input.countedCash.isNegative()) throw new InvalidCashCountError();
    this.props.openingFloat.add(input.countedCash);
    this.props.openingFloat.add(input.expectedCash);
    this.props.status = 'CLOSED';
    this.props.closedAt = input.closedAt ?? new Date();
    this.props.closedBy = input.closedBy;
    this.props.closeCommandId = input.commandId;
    this.props.expectedCashAtClose = input.expectedCash;
    this.props.countedCash = input.countedCash;
    this.props.difference = input.countedCash.subtract(input.expectedCash);
  }
}
