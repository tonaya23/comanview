import { z } from 'zod';
import { KdsRealtimeMessageSchema } from './kds.js';
import { TablesRealtimeMessageSchema } from './tables.js';

export const OrderRealtimeMessageSchema = z.object({
  type: z.literal('ORDER_UPDATED'),
  locationId: z.string().uuid(),
  orderId: z.string().uuid(),
  version: z.number().int().positive(),
  reason: z.enum([
    'ORDER_CREATED',
    'ITEM_ADDED',
    'ITEM_REMOVED',
    'ITEM_CONFIGURATION_UPDATED',
    'ITEM_SPECIAL_INSTRUCTIONS_UPDATED',
    'ROUND_SENT',
    'TABLES_UPDATED',
    'PAYMENT_COMPLETED',
    'PAYMENT_VOIDED',
    'PAYMENT_REQUESTED',
    'PREPARATION_UPDATED',
    'ORDER_CLOSED',
    'ORDER_CANCELLED',
  ]),
  occurredAt: z.string().datetime(),
});

export const OperationalRealtimeMessageSchema = z.union([
  KdsRealtimeMessageSchema,
  TablesRealtimeMessageSchema,
  OrderRealtimeMessageSchema,
]);
export type OperationalRealtimeMessage = z.infer<typeof OperationalRealtimeMessageSchema>;
export type OrderRealtimeMessage = z.infer<typeof OrderRealtimeMessageSchema>;
