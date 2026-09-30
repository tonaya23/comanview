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
  quantity: z.number().int().safe().min(1).optional(),
});

export const ProductSnapshotSchema = z.object({
  productId: z.string().uuid(),
  productName: z.string(),
  basePrice: MoneySchema,
  taxRateBasisPoints: z.number().int(),
  taxCalculationMode: z.enum(['TAX_INCLUDED', 'TAX_ADDED']),
  taxPolicyVersion: z.union([z.literal(0), z.literal(1)]).optional(),
  taxProfileId: z.string().uuid().nullable().optional(),
  taxProfileRevision: z.number().int().positive().nullable().optional(),
  stationId: z.string().uuid().nullable(),
  selectedModifiers: z.array(SelectedModifierSchema),
});

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  productSnapshot: ProductSnapshotSchema,
  // Authoritative, per-line rounded amounts from Edge. Optional only for legacy responses.
  quantity: z.number().int().positive().optional(),
  lineBase: MoneySchema.optional(),
  lineTax: MoneySchema.optional(),
  lineTotal: MoneySchema.optional(),
  specialInstructions: z.string().max(500).nullable(),
  status: OrderItemSendStatusSchema,
  prepStatus: z.enum(['PENDING', 'PREPARING', 'READY']).default('PENDING'),
  addedAt: z.string(),
  sentAt: z.string().nullable(),
}).superRefine((item, context) => {
  if (item.productSnapshot.taxPolicyVersion === 1 && (!item.lineBase || !item.lineTax || !item.lineTotal ||
    !item.quantity || !item.productSnapshot.taxProfileId || !item.productSnapshot.taxProfileRevision))
    context.addIssue({ code: 'custom', message: 'Fiscal policy 1 requires the captured revision and authoritative line amounts.' });
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
  paymentRequestedAt: z.string().datetime().nullable().default(null),
  tableIds: z.array(z.string().uuid()),
  items: z.array(OrderItemSchema),
  rounds: z.array(RoundSchema),
  subtotal: MoneySchema,
  taxTotal: MoneySchema.optional(),
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
export const ModifierSelectionSchema = z.object({
  modifierOptionId: z.string().uuid(),
  quantity: z.number().int().safe().min(1),
});
export type ModifierSelection = z.infer<typeof ModifierSelectionSchema>;
function validateSelections(value: {selectedModifierIds?: string[] | undefined; selectedModifiers?: ModifierSelection[] | undefined}, ctx: z.RefinementCtx) {
  if(value.selectedModifierIds !== undefined && value.selectedModifiers !== undefined)
    ctx.addIssue({code:'custom',message:'Use one modifier selection representation, not both.'});
  const ids=value.selectedModifiers?.map(x=>x.modifierOptionId)??value.selectedModifierIds??[];
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Duplicate modifier option IDs are not allowed.'});
}
export const CreateOrderRequestSchema = z.object({
  commandId: z.string().min(1).optional(),
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
  selectedModifiers: z.array(ModifierSelectionSchema).optional(),
  specialInstructions: z.string().nullable().optional(),
}).superRefine(validateSelections);
export type AddOrderItemRequest = z.infer<typeof AddOrderItemRequestSchema>;

export const SendRoundRequestSchema = z.object({
  commandId: z.string().min(1),
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
  emptyCounterOnly: z.literal(true).optional(),
});
export type CancelOrderRequest = z.infer<typeof CancelOrderRequestSchema>;

export const CancelEmptyTableOrderRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
});
export type CancelEmptyTableOrderRequest = z.infer<typeof CancelEmptyTableOrderRequestSchema>;

export const RequestOrderPaymentRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
});
export type RequestOrderPaymentRequest = z.infer<typeof RequestOrderPaymentRequestSchema>;

export const RemoveOrderItemRequestSchema = z.object({
  expectedVersion: z.number().int(),
});
export type RemoveOrderItemRequest = z.infer<typeof RemoveOrderItemRequestSchema>;

export const UpdateOrderItemSpecialInstructionsRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
  specialInstructions: z.string().nullable(),
});
export type UpdateOrderItemSpecialInstructionsRequest = z.infer<
  typeof UpdateOrderItemSpecialInstructionsRequestSchema
>;

export const UpdateDraftOrderItemConfigurationRequestSchema = z.object({
  commandId: z.string().min(1),
  expectedVersion: z.number().int(),
  selectedModifierIds: z.array(z.string().uuid()).optional(),
  selectedModifiers: z.array(ModifierSelectionSchema).optional(),
  specialInstructions: z.string().nullable(),
}).superRefine((value,ctx)=>{
  validateSelections(value,ctx);
  if(value.selectedModifierIds===undefined&&value.selectedModifiers===undefined)
    ctx.addIssue({code:'custom',message:'Explicit modifier selections are required for reconfiguration.'});
});
export type UpdateDraftOrderItemConfigurationRequest = z.infer<
  typeof UpdateDraftOrderItemConfigurationRequestSchema
>;
