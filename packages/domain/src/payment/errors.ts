import { DomainError } from '../shared/DomainError.js';

export class InvalidPaymentAmountError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_PAYMENT_AMOUNT');
  }
}

export class PaymentOverpaymentError extends DomainError {
  constructor(balanceDue: number, attemptedAmount: number, currency: string) {
    super(
      `Payment amount_applied ${attemptedAmount} ${currency} exceeds balance_due ${balanceDue} ${currency}.`,
      'PAYMENT_OVERPAYMENT',
    );
  }
}

export class InvalidCashTenderedError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_CASH_TENDERED');
  }
}

export class PaymentCurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(
      `Payment currency ${actual} does not match Order currency ${expected}.`,
      'PAYMENT_CURRENCY_MISMATCH',
    );
  }
}

export class PaymentNotFoundError extends DomainError {
  constructor(paymentId: string) {
    super(`Payment ${paymentId} was not found in this Order.`, 'PAYMENT_NOT_FOUND');
  }
}

export class PaymentNotCompletedError extends DomainError {
  constructor(paymentId: string, status: string) {
    super(`Payment ${paymentId} cannot be voided from status ${status}.`, 'PAYMENT_NOT_COMPLETED');
  }
}

export class TipsDisabledError extends DomainError {
  constructor() {
    super('Tips are disabled for this Location.', 'TIPS_DISABLED');
  }
}

export class InvalidTipError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_TIP');
  }
}
