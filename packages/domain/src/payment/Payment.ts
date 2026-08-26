import { Money } from '@comanview/money';
import { EntityId } from '../shared/EntityId.js';
import {
  InvalidCashTenderedError,
  InvalidPaymentAmountError,
  PaymentCurrencyMismatchError,
  PaymentNotCompletedError,
} from './errors.js';
import type { PaymentMethod, PaymentStatus } from './types.js';

export interface PaymentProps {
  id: EntityId;
  orderId: EntityId;
  cashSessionId: EntityId;
  method: PaymentMethod;
  amountApplied: Money;
  tipAmount: Money;
  cashTendered: Money | null;
  changeGiven: Money;
  status: PaymentStatus;
  externalReference: string | null;
  commandId: string;
  createdAt: Date;
  completedAt: Date | null;
  voidedAt: Date | null;
}

export interface CompletePaymentProps {
  orderId: EntityId;
  cashSessionId: EntityId;
  method: PaymentMethod;
  amountApplied: Money;
  tipAmount: Money;
  cashTendered?: Money | null;
  externalReference?: string | null;
  commandId: string;
}

export class Payment {
  private constructor(private props: PaymentProps) {}

  static complete(input: CompletePaymentProps): Payment {
    if (!input.amountApplied.isPositive()) {
      throw new InvalidPaymentAmountError('amount_applied must be greater than zero.');
    }
    if (input.tipAmount.isNegative()) {
      throw new InvalidPaymentAmountError('tip_amount must not be negative.');
    }
    if (input.tipAmount.currency !== input.amountApplied.currency) {
      throw new PaymentCurrencyMismatchError(
        input.amountApplied.currency,
        input.tipAmount.currency,
      );
    }

    const chargedTotal = input.amountApplied.add(input.tipAmount);
    let cashTendered: Money | null = null;
    let changeGiven = Money.zero(input.amountApplied.currency);

    if (input.method === 'CASH') {
      if (!input.cashTendered) {
        throw new InvalidCashTenderedError('cash_tendered is required for CASH Payments.');
      }
      if (input.cashTendered.currency !== input.amountApplied.currency) {
        throw new PaymentCurrencyMismatchError(
          input.amountApplied.currency,
          input.cashTendered.currency,
        );
      }
      if (input.cashTendered.lessThan(chargedTotal)) {
        throw new InvalidCashTenderedError(
          `cash_tendered must cover charged_total ${chargedTotal.amount} ${chargedTotal.currency}.`,
        );
      }
      cashTendered = input.cashTendered;
      changeGiven = input.cashTendered.subtract(chargedTotal);
    } else if (input.cashTendered !== undefined && input.cashTendered !== null) {
      throw new InvalidCashTenderedError('cash_tendered is only valid for CASH Payments.');
    }

    const now = new Date();
    return new Payment({
      id: EntityId.generate(),
      orderId: input.orderId,
      cashSessionId: input.cashSessionId,
      method: input.method,
      amountApplied: input.amountApplied,
      tipAmount: input.tipAmount,
      cashTendered,
      changeGiven,
      status: 'COMPLETED',
      externalReference: input.externalReference?.trim() || null,
      commandId: input.commandId,
      createdAt: now,
      completedAt: now,
      voidedAt: null,
    });
  }

  static rehydrate(props: PaymentProps): Payment {
    return new Payment(props);
  }

  get id(): EntityId {
    return this.props.id;
  }
  get orderId(): EntityId {
    return this.props.orderId;
  }
  get cashSessionId(): EntityId {
    return this.props.cashSessionId;
  }
  get method(): PaymentMethod {
    return this.props.method;
  }
  get amountApplied(): Money {
    return this.props.amountApplied;
  }
  get tipAmount(): Money {
    return this.props.tipAmount;
  }
  get cashTendered(): Money | null {
    return this.props.cashTendered;
  }
  get changeGiven(): Money {
    return this.props.changeGiven;
  }
  get status(): PaymentStatus {
    return this.props.status;
  }
  get externalReference(): string | null {
    return this.props.externalReference;
  }
  get commandId(): string {
    return this.props.commandId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }
  get voidedAt(): Date | null {
    return this.props.voidedAt;
  }
  get chargedTotal(): Money {
    return this.props.amountApplied.add(this.props.tipAmount);
  }

  void(): void {
    if (this.props.status !== 'COMPLETED') {
      throw new PaymentNotCompletedError(this.id.toString(), this.props.status);
    }
    this.props.status = 'VOIDED';
    this.props.voidedAt = new Date();
  }
}
