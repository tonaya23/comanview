import { z } from 'zod';

export const KdsPreparationStatusSchema = z.enum(['PENDING', 'PREPARING', 'READY']);
export type KdsPreparationStatus = z.infer<typeof KdsPreparationStatusSchema>;

export const KdsStationSchema = z.object({
  stationId: z.string().uuid(),
  name: z.string().min(1),
});
export type KdsStationResponse = z.infer<typeof KdsStationSchema>;

export const KdsModifierSnapshotSchema = z.object({
  modifierOptionId: z.string().uuid(),
  name: z.string(),
});

export const KdsItemSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  productName: z.string(),
  modifiers: z.array(KdsModifierSnapshotSchema),
  specialInstructions: z.string().nullable(),
  prepStatus: KdsPreparationStatusSchema,
});

export const KdsTicketSchema = z.object({
  ticketId: z.string().min(1),
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  orderType: z.enum(['COUNTER', 'TABLE', 'TAKEOUT']),
  roundId: z.string().uuid(),
  roundNumber: z.number().int().positive(),
  stationId: z.string().uuid(),
  stationName: z.string(),
  status: KdsPreparationStatusSchema,
  sentAt: z.string(),
  preparingAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  items: z.array(KdsItemSchema).min(1),
});
export type KdsTicketResponse = z.infer<typeof KdsTicketSchema>;

export const KdsTicketQuerySchema = z.object({
  stationId: z.string().uuid(),
  status: KdsPreparationStatusSchema.optional(),
});
export type KdsTicketQuery = z.infer<typeof KdsTicketQuerySchema>;

export const KdsTransitionRequestSchema = z.object({ commandId: z.string().min(1) });
export type KdsTransitionRequest = z.infer<typeof KdsTransitionRequestSchema>;

export const KdsRealtimeMessageSchema = z.object({
  type: z.literal('KDS_TICKETS_CHANGED'),
  stationIds: z.array(z.string().uuid()),
  reason: z.enum(['ROUND_SENT', 'PREPARING', 'READY']),
  occurredAt: z.string(),
});
export type KdsRealtimeMessage = z.infer<typeof KdsRealtimeMessageSchema>;
