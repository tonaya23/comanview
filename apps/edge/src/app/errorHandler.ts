import { FastifyReply, FastifyRequest } from 'fastify';
import {
  DomainError,
  OrderNotOpenError,
  OrderItemSentError,
  OrderItemNotFoundError,
  OrderItemProductMismatchError,
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
  EmptyTableCancellationError,
  PaymentCurrencyMismatchError,
  PaymentNotCompletedError,
  PaymentNotFoundError,
  PaymentOverpaymentError,
  TipsDisabledError,
  KdsInvalidTransitionError,
  KdsInconsistentTicketStateError,
} from '@comanview/domain';
import {
  ConcurrencyError,
  ObjectNotFoundError,
  InvalidStateError,
  InvariantViolationError,
} from './errors.js';
import {
  ErrorCode as ErrorCodeSchema,
  PublicErrorDetailsSchema,
  type ErrorCode,
  type ErrorResponse,
  type PublicErrorDetails,
} from '@comanview/contracts';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: PublicErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function parseContractErrorCode(value: unknown): ErrorCode | null {
  const parsed = ErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function diagnosticId(request: FastifyRequest): string | undefined {
  const value = String(request.id ?? '');
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : undefined;
}

function publicDetails(request: FastifyRequest, details?: PublicErrorDetails): PublicErrorDetails | undefined {
  const id = diagnosticId(request);
  const parsed = PublicErrorDetailsSchema.safeParse({ ...details, ...(id ? { diagnosticId: id } : {}) });
  if (parsed.success && Object.keys(parsed.data).length > 0) return parsed.data;
  return id ? { diagnosticId: id } : undefined;
}

function validationDetails(request: FastifyRequest, validation: unknown): PublicErrorDetails | undefined {
  const validationIssues = Array.isArray(validation) ? validation.slice(0, 32).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { instancePath?: unknown; message?: unknown; keyword?: unknown };
    if (typeof candidate.message !== 'string' || candidate.message.length === 0) return [];
    const keyword = typeof candidate.keyword === 'string' ? candidate.keyword.slice(0, 80) : undefined;
    const message = keyword === 'required' ? 'Required field.' :
      keyword === 'additionalProperties' ? 'Unsupported field.' : 'Invalid value.';
    return [{
      path: typeof candidate.instancePath === 'string' ? candidate.instancePath.slice(0, 240) : '',
      message,
      ...(keyword
        ? { keyword }
        : {}),
    }];
  }) : [];
  return publicDetails(request, validationIssues.length > 0 ? { validationIssues } : undefined);
}

export function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
  request.log.error({ err: error }, 'Request failed');

  // Fastify schema validation errors have statusCode=400 and code=FST_ERR_VALIDATION
  const fastifyError = error as any;
  if (fastifyError.statusCode === 400 && fastifyError.code === 'FST_ERR_VALIDATION') {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: validationDetails(request, fastifyError.validation),
    } satisfies ErrorResponse);
    return;
  }

  let statusCode = 500;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: PublicErrorDetails | undefined;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (['TAX_CONFIGURATION_REQUIRED', 'TAX_PROFILE_REQUIRED', 'TAX_REVISION_INCONSISTENT',
    'TAX_SNAPSHOT_IMMUTABLE', 'TAX_PROFILE_REQUIRES_ADMIN_COMMAND', 'TAX_SCHEMA_REQUIRED',
    'TAX_SCHEMA_INCOMPLETE', 'TAX_POLICY_VERSION_INVALID', 'TAX_REVISION_INVALID',
    'TAX_SNAPSHOT_MISSING'].includes(error.message)) {
    statusCode = 409;
    code = parseContractErrorCode(error.message) ?? 'DOMAIN_CONFLICT';
    message = 'La configuración fiscal requiere revisión; no se modificó el snapshot existente.';
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
    } else if (error instanceof OrderItemProductMismatchError) {
      statusCode = 409;
      code = 'ORDER_ITEM_PRODUCT_MISMATCH';
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
    } else if (error instanceof EmptyTableCancellationError) {
      statusCode = 409;
      code = parseContractErrorCode(error.code) ?? 'DOMAIN_ERROR';
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
      code = parseContractErrorCode(error.code) ?? 'DOMAIN_ERROR';
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
      code = parseContractErrorCode(error.code) ?? 'DOMAIN_ERROR';
    } else if (error instanceof InvalidPaymentAmountError || error instanceof InvalidTipError) {
      statusCode = 400;
      code = parseContractErrorCode(error.code) ?? 'DOMAIN_ERROR';
    } else if (
      error instanceof KdsInvalidTransitionError ||
      error instanceof KdsInconsistentTicketStateError
    ) {
      statusCode = 409;
      code = parseContractErrorCode(error.code) ?? 'DOMAIN_ERROR';
    } else {
      statusCode = 400;
      code = parseContractErrorCode((error as DomainError).code) ?? 'DOMAIN_ERROR';
    }
    message = error.message;
  }

  const response: ErrorResponse = {
    error: code,
    message,
    details: publicDetails(request, details),
  };

  reply.status(statusCode).send(response);
}
