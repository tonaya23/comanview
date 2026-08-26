import { FastifyReply, FastifyRequest } from 'fastify';
import {
  DomainError,
  OrderNotOpenError,
  OrderItemSentError,
  OrderItemNotFoundError,
  OrderItemSpecialInstructionsFrozenError,
  SpecialInstructionsTooLongError,
  NoDraftItemsError,
  OrderBalanceNotZeroError,
  OrderHasDraftItemsError,
  OrderCurrencyMismatchError,
  ProductUnavailableError,
  ProductInactiveError,
  TaxProfileInactiveError,
  InvalidModifierSelectionError,
  ModifierUnavailableError,
  ModifierInactiveError,
  TableAssignmentError,
  InvalidCashTenderedError,
  InvalidPaymentAmountError,
  InvalidTipError,
  OrderPaidAmountExceedsTotalError,
  PaymentCurrencyMismatchError,
  PaymentNotCompletedError,
  PaymentNotFoundError,
  PaymentOverpaymentError,
  TipsDisabledError,
} from '@comanview/domain';
import {
  ConcurrencyError,
  ObjectNotFoundError,
  InvalidStateError,
  InvariantViolationError,
} from './errors.js';
import { ErrorResponse } from '@comanview/contracts';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
  request.log.error({ err: error }, 'Request failed');

  // Fastify schema validation errors have statusCode=400 and code=FST_ERR_VALIDATION
  const fastifyError = error as any;
  if (fastifyError.statusCode === 400 && fastifyError.code === 'FST_ERR_VALIDATION') {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: error.message,
      details: fastifyError.validation,
    } as ErrorResponse);
    return;
  }

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: any = undefined;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ConcurrencyError) {
    statusCode = 409;
    code = 'STALE_ORDER_VERSION';
    message = error.message;
  } else if (error instanceof ObjectNotFoundError) {
    statusCode = 404;
    const msg = error.message.toLowerCase();
    if (msg.includes('order')) code = 'ORDER_NOT_FOUND';
    else if (msg.includes('product')) code = 'PRODUCT_NOT_FOUND';
    else code = 'NOT_FOUND';
    message = error.message;
  } else if (error instanceof InvalidStateError || error instanceof InvariantViolationError) {
    statusCode = 409;
    code = 'DOMAIN_CONFLICT';
    message = error.message;
  } else if (error instanceof DomainError) {
    // Map specific domain errors to stable codes
    if (error instanceof OrderNotOpenError) {
      statusCode = 409;
      code = 'ORDER_ALREADY_CLOSED';
    } else if (error instanceof OrderItemSentError) {
      statusCode = 409;
      code = 'ORDER_ITEM_SENT';
    } else if (error instanceof OrderItemNotFoundError) {
      statusCode = 404;
      code = 'ORDER_ITEM_NOT_FOUND';
    } else if (error instanceof OrderItemSpecialInstructionsFrozenError) {
      statusCode = 409;
      code = 'ORDER_ITEM_SPECIAL_INSTRUCTIONS_FROZEN';
    } else if (error instanceof SpecialInstructionsTooLongError) {
      statusCode = 400;
      code = 'SPECIAL_INSTRUCTIONS_TOO_LONG';
    } else if (error instanceof NoDraftItemsError) {
      statusCode = 409;
      code = 'NO_DRAFT_ITEMS';
    } else if (error instanceof OrderBalanceNotZeroError) {
      statusCode = 409;
      code = 'ORDER_BALANCE_NOT_ZERO';
    } else if (error instanceof OrderHasDraftItemsError) {
      statusCode = 409;
      code = 'ORDER_HAS_DRAFT_ITEMS';
    } else if (error instanceof OrderCurrencyMismatchError) {
      statusCode = 409;
      code = 'ORDER_CURRENCY_MISMATCH';
    } else if (error instanceof ProductUnavailableError) {
      statusCode = 409;
      code = 'PRODUCT_UNAVAILABLE';
    } else if (error instanceof ProductInactiveError) {
      statusCode = 409;
      code = 'PRODUCT_INACTIVE';
    } else if (error instanceof TaxProfileInactiveError) {
      statusCode = 409;
      code = 'TAX_PROFILE_INACTIVE';
    } else if (error instanceof InvalidModifierSelectionError) {
      statusCode = 409;
      code = 'INVALID_MODIFIER_SELECTION';
    } else if (error instanceof ModifierUnavailableError) {
      statusCode = 409;
      code = 'MODIFIER_UNAVAILABLE';
    } else if (error instanceof ModifierInactiveError) {
      statusCode = 409;
      code = 'MODIFIER_INACTIVE';
    } else if (error instanceof TableAssignmentError) {
      statusCode = 409;
      code = 'DOMAIN_CONFLICT';
    } else if (error instanceof PaymentNotFoundError) {
      statusCode = 404;
      code = 'PAYMENT_NOT_FOUND';
    } else if (
      error instanceof PaymentOverpaymentError ||
      error instanceof InvalidCashTenderedError ||
      error instanceof PaymentCurrencyMismatchError ||
      error instanceof PaymentNotCompletedError ||
      error instanceof TipsDisabledError ||
      error instanceof OrderPaidAmountExceedsTotalError
    ) {
      statusCode = 409;
      code = error.code;
    } else if (error instanceof InvalidPaymentAmountError || error instanceof InvalidTipError) {
      statusCode = 400;
      code = error.code;
    } else {
      statusCode = 400;
      code = (error as DomainError).code ?? 'DOMAIN_ERROR';
    }
    message = error.message;
  }

  const response: ErrorResponse = {
    error: code as any,
    message,
    details,
  };

  reply.status(statusCode).send(response);
}
