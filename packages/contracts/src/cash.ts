import { z } from 'zod';
import { MoneySchema } from './catalog.js';

export const CashSessionSchema = z.object({
  id: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  status: z.enum(['OPEN', 'CLOSED']),
  openingFloat: MoneySchema,
  expectedCash: MoneySchema.nullable(),
  blindCashCount: z.boolean(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openedAt: z.string(),
  openedBy: z.string().uuid(),
  closedAt: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  countedCash: MoneySchema.nullable(),
  expectedCashAtClose: MoneySchema.nullable(),
  difference: MoneySchema.nullable(),
});
export type CashSessionResponse = z.infer<typeof CashSessionSchema>;

export const CurrentCashSessionSchema = z.object({
  session: CashSessionSchema.nullable(),
});
export type CurrentCashSessionResponse = z.infer<typeof CurrentCashSessionSchema>;

export const OpenCashSessionRequestSchema = z.object({
  commandId: z.string().min(1),
  openingFloatAmount: z.number().int().nonnegative(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type OpenCashSessionRequest = z.infer<typeof OpenCashSessionRequestSchema>;

export const CashMovementTypeSchema = z.enum(['CASH_IN', 'CASH_OUT']);
export const CashMovementSchema = z.object({
  id: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  type: CashMovementTypeSchema,
  amount: MoneySchema,
  reason: z.string(),
  actorUserId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  commandId: z.string(),
  expectedCash: MoneySchema,
});
export type CashMovementResponse = z.infer<typeof CashMovementSchema>;

export const CreateCashMovementRequestSchema = z.object({
  commandId: z.string().min(1),
  type: CashMovementTypeSchema,
  amount: z.number().int().positive(),
  reason: z.string().max(240),
});
export type CreateCashMovementRequest = z.infer<typeof CreateCashMovementRequestSchema>;

const MethodMoneySchema = z.object({ CASH: MoneySchema, CARD: MoneySchema, OTHER: MoneySchema });
const MethodCountSchema = z.object({
  CASH: z.number().int().nonnegative(),
  CARD: z.number().int().nonnegative(),
  OTHER: z.number().int().nonnegative(),
});

export const CashReportSnapshotSchema = z.object({
  reportId: z.string().uuid(),
  reportType: z.enum(['X', 'Z']),
  cashSessionId: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string(),
  openingFloat: MoneySchema,
  salesByMethod: MethodMoneySchema,
  tipsByMethod: MethodMoneySchema,
  paymentCountByMethod: MethodCountSchema,
  cashIn: MoneySchema,
  cashOut: MoneySchema,
  expectedCash: MoneySchema,
  countedCash: MoneySchema.nullable(),
  difference: MoneySchema.nullable(),
  voidCount: z.number().int().nonnegative(),
  discountTotal: MoneySchema,
  compTotal: MoneySchema,
  openedAt: z.string().datetime(),
  openedBy: z.string().uuid(),
  generatedAt: z.string().datetime(),
  generatedBy: z.string().uuid(),
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().uuid().nullable(),
  printJobId: z.string().uuid().nullable(),
});
export type CashReportSnapshotResponse = z.infer<typeof CashReportSnapshotSchema>;

export const GenerateXReportRequestSchema = z.object({ commandId: z.string().min(1) });
export type GenerateXReportRequest = z.infer<typeof GenerateXReportRequestSchema>;

export const PreviewCashClosingRequestSchema = z.object({
  countedCashAmount: z.number().int().nonnegative(),
});
export type PreviewCashClosingRequest = z.infer<typeof PreviewCashClosingRequestSchema>;

export const CashClosingPreviewSchema = CashReportSnapshotSchema.omit({
  reportId: true,
  reportType: true,
  generatedAt: true,
  generatedBy: true,
  closedAt: true,
  closedBy: true,
  printJobId: true,
}).extend({ countedCash: MoneySchema, difference: MoneySchema });
export type CashClosingPreviewResponse = z.infer<typeof CashClosingPreviewSchema>;

export const CloseCashSessionRequestSchema = z.object({
  commandId: z.string().min(1),
  countedCashAmount: z.number().int().nonnegative(),
});
export type CloseCashSessionRequest = z.infer<typeof CloseCashSessionRequestSchema>;

export const CloseCashSessionResponseSchema = z.object({
  session: CashSessionSchema,
  report: CashReportSnapshotSchema,
});
export type CloseCashSessionResponse = z.infer<typeof CloseCashSessionResponseSchema>;
