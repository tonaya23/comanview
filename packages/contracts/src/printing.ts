import { z } from 'zod';

export const PrintJobTypeSchema = z.enum(['STATION_TICKET', 'PRECHECK', 'CUSTOMER_RECEIPT']);
export const PrintJobStatusSchema = z.enum([
  'PENDING',
  'SENDING',
  'DELIVERED',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN',
  'CANCELLED',
]);
export const PrintJobSchema = z.object({
  printJobId: z.string().uuid(),
  orderId: z.string().uuid(),
  roundId: z.string().uuid().nullable(),
  stationId: z.string().uuid().nullable(),
  targetId: z.string().uuid().nullable(),
  jobType: PrintJobTypeSchema,
  status: PrintJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastError: z.string().nullable(),
});
export type PrintJobResponse = z.infer<typeof PrintJobSchema>;

export const RequestPrintJobSchema = z.object({ commandId: z.string().min(1) });
export type RequestPrintJob = z.infer<typeof RequestPrintJobSchema>;
