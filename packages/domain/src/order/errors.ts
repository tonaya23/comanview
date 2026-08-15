import { DomainError } from '../shared/DomainError.js';

export class OrderNotOpenError extends DomainError {
  constructor(orderId: string, status: string) {
    super(
      `Order ${orderId} is not OPEN (current status: ${status}). Cannot mutate a ${status} order.`,
      'ORDER_NOT_OPEN',
    );
  }
}

export class OrderItemSentError extends DomainError {
  constructor(itemId: string) {
    super(
      `OrderItem ${itemId} is SENT and cannot be removed or destructively modified.`,
      'ORDER_ITEM_SENT',
    );
  }
}

export class OrderItemNotFoundError extends DomainError {
  constructor(itemId: string) {
    super(`OrderItem ${itemId} not found in this Order.`, 'ORDER_ITEM_NOT_FOUND');
  }
}

export class NoDraftItemsError extends DomainError {
  constructor(orderId: string) {
    super(
      `Order ${orderId} has no DRAFT items to send.`,
      'NO_DRAFT_ITEMS',
    );
  }
}

export class TableAssignmentError extends DomainError {
  constructor(message: string) {
    super(message, 'TABLE_ASSIGNMENT_ERROR');
  }
}

/**
 * Thrown when attempting to close an Order whose balance_due is not zero.
 * The caller (Application Layer) is responsible for computing balance_due
 * and passing it to Order.close(). The domain enforces that it must be zero (INV-15).
 */
export class OrderBalanceNotZeroError extends DomainError {
  constructor(orderId: string, balanceDue: number, currency: string) {
    super(
      `Order ${orderId} cannot be closed: balance_due is ${balanceDue} ${currency}, expected 0.`,
      'ORDER_BALANCE_NOT_ZERO',
    );
  }
}

/**
 * Thrown when a ProductSnapshot with a different currency than the Order's currency
 * is added. V1 requires a single currency per Order (and per Location).
 */
export class OrderCurrencyMismatchError extends DomainError {
  constructor(orderId: string, orderCurrency: string, snapshotCurrency: string) {
    super(
      `Order ${orderId} uses currency ${orderCurrency}, but the snapshot uses ${snapshotCurrency}.`,
      'ORDER_CURRENCY_MISMATCH',
    );
  }
}

