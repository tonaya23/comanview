import { z } from 'zod';

export const ErrorCode = z.enum([
  'ORDER_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'PRODUCT_INACTIVE',
  'TAX_PROFILE_INACTIVE',
  'INVALID_MODIFIER_SELECTION',
  'ORDER_ALREADY_CLOSED',
  'ORDER_ALREADY_CANCELLED',
  'ORDER_ITEM_SENT',
  'ORDER_ITEM_NOT_FOUND',
  'ORDER_BALANCE_NOT_ZERO',
  'ORDER_CURRENCY_MISMATCH',
  'NO_DRAFT_ITEMS',
  'STALE_ORDER_VERSION',
  'DOMAIN_CONFLICT',
  'DOMAIN_ERROR',
  'VALIDATION_ERROR',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponseSchema = z.object({
  error: ErrorCode,
  message: z.string(),
  details: z.any().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
