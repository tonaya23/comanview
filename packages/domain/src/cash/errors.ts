import { DomainError } from '../shared/DomainError.js';

export class InvalidOpeningFloatError extends DomainError {
  constructor() {
    super('opening_float must be an explicit non-negative amount.', 'INVALID_OPENING_FLOAT');
  }
}

export class InvalidBusinessDateError extends DomainError {
  constructor(value: string) {
    super(
      `business_date must be a valid YYYY-MM-DD value. Received: ${value}.`,
      'INVALID_BUSINESS_DATE',
    );
  }
}

export class CashSessionAlreadyOpenError extends DomainError {
  constructor(cashRegisterId: string) {
    super(
      `CashRegister ${cashRegisterId} already has an OPEN CashSession.`,
      'CASH_SESSION_ALREADY_OPEN',
    );
  }
}

export class CashSessionNotOpenError extends DomainError {
  constructor() {
    super('A POS Payment requires an OPEN CashSession.', 'CASH_SESSION_NOT_OPEN');
  }
}
