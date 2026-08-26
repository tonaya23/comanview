import { z } from 'zod';
import { MoneySchema } from './catalog.js';
import { PaymentSchema } from './payment.js';

// Enums
export const OrderStatusSchema = z.enum(['OPEN', 'CLOSED', 'CANCELLED']);
export const OrderTypeSchema = z.enum(['COUNTER', 'TABLE', 'TAKEOUT']);
export const OrderChannelSchema = z.enum(['POS', 'WAITER']);
export const OrderItemSendStatusSchema = z.enum(['DRAFT', 'SENT']);

export const SelectedModifierSchema = z.object({
  modifierOptionId: z.string().uuid(),
  name: z.string(),
  priceDelta: MoneySchema,
});

export const ProductSnapshotSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string(),
  basePrice: MoneySchema,
  taxRateBasisPoints: z.number().int(),
  taxCalculationMode: z.enum(['TAX_INCLUDED', 'TAX_ADDED']),
  stationId: z.string().uuid().nullable(),
  selectedModifiers: z.array(SelectedModifierSchema),
});

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  productSnapshot: ProductSnapshotSchema,
  status: OrderItemSendStatusSchema,
  addedAt: z.string(),
  sentAt: z.string().nullable(),
});

export const RoundSchema = z.object({
  id: z.string().uuid(),
  roundNumber: z.number().int(),
  sentAt: z.string(),
  itemIds: z.array(z.string().uuid()),
});

export const OrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  orderType: OrderTypeSchema,
  channel: OrderChannelSchema,
  currency: z.string().length(3),
  status: OrderStatusSchema,
  tableIds: z.array(z.string().uuid()),
  items: z.array(OrderItemSchema),
  rounds: z.array(RoundSchema),
  subtotal: MoneySchema,
  total: MoneySchema,
  paidAmount: MoneySchema,
  balanceDue: MoneySchema,
  tipTotal: MoneySchema,
  payments: z.array(PaymentSchema),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OrderResponse = z.infer<typeof OrderSchema>;

// Requests
export const CreateOrderRequestSchema = z.object({
  orderType: OrderTypeSchema,
  channel: OrderChannelSchema,
  currency: z.string().length(3),
  tableIds: z.array(z.string().uuid()).optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

export const AddOrderItemRequestSchema = z.object({
  commandId: z.string(), // For idempotency
  expectedVersion: z.number().int(), // For OCC
  productId: z.string().uuid(),
  selectedModifierIds: z.array(z.string().uuid()).optional(),
});
export type AddOrderItemRequest = z.infer<typeof AddOrderItemRequestSchema>;

export const SendRoundRequestSchema = z.object({
  expectedVersion: z.number().int(),
});
export type SendRoundRequest = z.infer<typeof SendRoundRequestSchema>;

export const CloseOrderRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
});
export type CloseOrderRequest = z.infer<typeof CloseOrderRequestSchema>;

export const CancelOrderRequestSchema = z.object({
  expectedVersion: z.number().int(),
});
export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>;

export const RemoveOrderItemRequestSchema = z.object({
  expectedVersion: z.number().int(),
});
export type RemoveOrderItemRequest = z.infer<typeof RemoveOrderItemRequestSchema>;

export const UpdateOrderTablesRequestSchema = z.object({
  expectedVersion: z.number().int(),
  tableIds: z.array(z.string().uuid()),
});
export type UpdateOrderTablesRequest = z.infer<typeof UpdateOrderTablesRequestSchema>;
