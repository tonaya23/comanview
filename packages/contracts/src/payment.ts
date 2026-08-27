import { z } from 'zod';
import { MoneySchema } from './catalog.js';

export const PaymentMethodSchema = z.enum(['CASH', 'CARD', 'OTHER']);
export const PaymentStatusSchema = z.enum(['PENDING', 'COMPLETED', 'VOIDED']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  method: PaymentMethodSchema,
  amountApplied: MoneySchema,
  tipAmount: MoneySchema,
  chargedTotal: MoneySchema,
  cashTendered: MoneySchema.nullable(),
  changeGiven: MoneySchema,
  status: PaymentStatusSchema,
  externalReference: z.string().nullable(),
  commandId: z.string(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
});
export type PaymentResponse = z.infer<typeof PaymentSchema>;

export const TipSelectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({ type: z.literal('FIXED_AMOUNT'), amount: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('PERCENTAGE'),
    basisPoints: z.number().int().min(0).max(10_000),
  }),
  z.object({ type: z.literal('REMAINDER') }),
]);
export type TipSelection = z.infer<typeof TipSelectionSchema>;

export const CreatePaymentRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  method: PaymentMethodSchema,
  amountApplied: z.number().int().positive(),
  tip: TipSelectionSchema,
  cashTendered: z.number().int().nonnegative().nullable().optional(),
  externalReference: z.string().trim().max(120).nullable().optional(),
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const VoidPaymentRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});
export type VoidPaymentRequest = z.infer<typeof VoidPaymentRequestSchema>;

export const PaymentConfigSchema = z.object({
  tipsEnabled: z.boolean(),
  percentageOptionsBasisPoints: z.array(z.number().int().nonnegative()),
});
export type PaymentConfigResponse = z.infer<typeof PaymentConfigSchema>;
