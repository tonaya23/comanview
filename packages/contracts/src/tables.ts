import { z } from 'zod';

export const TableOperationalStatusSchema = z.enum([
  'FREE',
  'OPEN',
  'READY',
  'PAYMENT_REQUESTED',
]);

export const RestaurantTableSchema = z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  name: z.string().min(1),
  zone: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  displayOrder: z.number().int(),
  active: z.boolean(),
  status: TableOperationalStatusSchema,
  activeOrderId: z.string().uuid().nullable(),
  activeOrderNumber: z.string().nullable(),
  activeOrderCreatedAt: z.string().datetime().nullable().default(null),
  paymentRequestedAt: z.string().datetime().nullable().default(null),
  pendingItemCount: z.number().int().nonnegative().default(0),
  preparingItemCount: z.number().int().nonnegative().default(0),
  readyItemCount: z.number().int().nonnegative().default(0),
  draftItemCount: z.number().int().nonnegative().default(0),
  total: z
    .object({ amount: z.number().int(), currency: z.string().length(3) })
    .nullable()
    .default(null),
  balanceDue: z
    .object({ amount: z.number().int(), currency: z.string().length(3) })
    .nullable()
    .default(null),
});

export const UpdateOrderTablesRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
  tableIds: z.array(z.string().uuid()).min(1),
});

export const TablesRealtimeMessageSchema = z.object({
  type: z.literal('TABLES_CHANGED'),
  locationId: z.string().uuid(),
  tableIds: z.array(z.string().uuid()),
  orderId: z.string().uuid(),
  reason: z.enum([
    'ORDER_OPENED',
    'ORDER_UPDATED',
    'TABLES_UPDATED',
    'PREPARATION_UPDATED',
    'PAYMENT_REQUESTED',
    'ORDER_RELEASED',
  ]),
  occurredAt: z.string().datetime(),
});

export type RestaurantTableResponse = z.infer<typeof RestaurantTableSchema>;
export type UpdateOrderTablesRequest = z.infer<typeof UpdateOrderTablesRequestSchema>;
export type TablesRealtimeMessage = z.infer<typeof TablesRealtimeMessageSchema>;
