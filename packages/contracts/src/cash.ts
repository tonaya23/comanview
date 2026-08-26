import { z } from 'zod';
import { MoneySchema } from './catalog.js';

export const CashSessionSchema = z.object({
  id: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  status: z.enum(['OPEN', 'CLOSED']),
  openingFloat: MoneySchema,
  expectedCash: MoneySchema,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openedAt: z.string(),
  openedBy: z.string().uuid(),
  closedAt: z.string().nullable(),
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
