import { z } from 'zod';
import type { ClaimedCloudEvent, ProjectionAction } from '@comanview/database';

const uuid = z.string().uuid();
const money = z.object({ amount: z.number().int().safe(), currency: z.string().min(3).max(3) });

const schemas = {
  ORDER_CREATED: z.object({
    orderType: z.string().min(1),
    orderChannel: z.string().min(1),
    tableIds: z.array(uuid),
  }),
  ITEM_ADDED: z.object({
    itemId: uuid,
    productName: z.string(),
    specialInstructions: z.string().nullable(),
  }),
  ITEM_REMOVED: z.object({ itemId: uuid }),
  ITEM_SPECIAL_INSTRUCTIONS_UPDATED: z.object({
    itemId: uuid,
    specialInstructions: z.string().nullable(),
  }),
  ITEM_CONFIGURATION_UPDATED: z.object({
    itemId: uuid,
    productId: uuid,
    modifierOptionIds: z.array(uuid),
    specialInstructions: z.string().nullable(),
  }),
  ROUND_SENT: z.object({ roundId: uuid, itemIds: z.array(uuid).min(1) }),
  ORDER_CLOSED: z.object({ orderId: uuid }),
  ORDER_CANCELLED: z.object({ orderId: uuid }),
  TABLES_UPDATED: z.object({ tableIds: z.array(uuid).min(1) }),
  PAYMENT_REQUESTED: z.object({ paymentRequestedAt: z.string().datetime() }),
  PAYMENT_COMPLETED: z.object({
    paymentId: uuid,
    cashSessionId: uuid,
    method: z.enum(['CASH', 'CARD', 'OTHER']),
    amountApplied: z.number().int().safe().nonnegative(),
    tipAmount: z.number().int().safe().nonnegative(),
    currency: z.string().min(3).max(3),
  }),
  PAYMENT_VOIDED: z.object({ paymentId: uuid }),
  KDS_TICKET_PREPARING: z.object({
    roundId: uuid,
    stationId: uuid,
    status: z.literal('PREPARING'),
  }),
  KDS_TICKET_READY: z.object({
    roundId: uuid,
    stationId: uuid,
    status: z.literal('READY'),
  }),
  CASH_SESSION_OPENED: z.object({
    cashSessionId: uuid,
    cashRegisterId: uuid,
    openingFloat: money,
    businessDate: z.string().date(),
  }),
  CASH_MOVEMENT_CREATED: z.object({
    cashMovementId: uuid,
    cashSessionId: uuid,
    movementType: z.enum(['CASH_IN', 'CASH_OUT']),
    amount: money,
    reason: z.string().min(1),
    actorUserId: uuid,
  }),
  CASH_SESSION_CLOSED: z.object({
    cashSessionId: uuid,
    businessDate: z.string().date(),
    expectedCash: money,
    countedCash: money,
    difference: money,
    closedBy: uuid,
  }),
} as const;

export const knownProjectionEventTypes = new Set(Object.keys(schemas));

export function toProjectionAction(event: ClaimedCloudEvent): ProjectionAction | null {
  if (event.schemaVersion !== 1) {
    throw new Error(`Unsupported event schema version ${event.schemaVersion}.`);
  }
  switch (event.eventType) {
    case 'ORDER_CREATED': {
      const payload = schemas.ORDER_CREATED.parse(event.payload);
      return {
        type: 'ORDER_CREATED',
        orderType: payload.orderType,
        orderChannel: payload.orderChannel,
        tableIds: payload.tableIds,
      };
    }
    case 'ITEM_ADDED':
      schemas.ITEM_ADDED.parse(event.payload);
      return { type: 'ORDER_ITEM_ADDED' };
    case 'ITEM_REMOVED':
      schemas.ITEM_REMOVED.parse(event.payload);
      return { type: 'ORDER_ITEM_REMOVED' };
    case 'ITEM_SPECIAL_INSTRUCTIONS_UPDATED':
      schemas.ITEM_SPECIAL_INSTRUCTIONS_UPDATED.parse(event.payload);
      return { type: 'NOOP' };
    case 'ITEM_CONFIGURATION_UPDATED':
      schemas.ITEM_CONFIGURATION_UPDATED.parse(event.payload);
      return { type: 'NOOP' };
    case 'ROUND_SENT': {
      const payload = schemas.ROUND_SENT.parse(event.payload);
      return { type: 'ORDER_ROUND_SENT', itemCount: payload.itemIds.length };
    }
    case 'TABLES_UPDATED': {
      const payload = schemas.TABLES_UPDATED.parse(event.payload);
      return { type: 'ORDER_TABLES_UPDATED', tableIds: payload.tableIds };
    }
    case 'PAYMENT_REQUESTED': {
      const payload = schemas.PAYMENT_REQUESTED.parse(event.payload);
      return {
        type: 'ORDER_PAYMENT_REQUESTED',
        paymentRequestedAt: new Date(payload.paymentRequestedAt),
      };
    }
    case 'PAYMENT_COMPLETED': {
      const payload = schemas.PAYMENT_COMPLETED.parse(event.payload);
      return { type: 'PAYMENT_COMPLETED', ...payload };
    }
    case 'PAYMENT_VOIDED': {
      const payload = schemas.PAYMENT_VOIDED.parse(event.payload);
      return { type: 'PAYMENT_VOIDED', paymentId: payload.paymentId };
    }
    case 'ORDER_CLOSED':
      schemas.ORDER_CLOSED.parse(event.payload);
      return { type: 'ORDER_CLOSED' };
    case 'ORDER_CANCELLED':
      schemas.ORDER_CANCELLED.parse(event.payload);
      return { type: 'ORDER_CANCELLED' };
    case 'KDS_TICKET_PREPARING':
      schemas.KDS_TICKET_PREPARING.parse(event.payload);
      return { type: 'NOOP' };
    case 'KDS_TICKET_READY':
      schemas.KDS_TICKET_READY.parse(event.payload);
      return { type: 'NOOP' };
    case 'CASH_SESSION_OPENED': {
      const payload = schemas.CASH_SESSION_OPENED.parse(event.payload);
      return {
        type: 'CASH_SESSION_OPENED',
        cashSessionId: payload.cashSessionId,
        cashRegisterId: payload.cashRegisterId,
        openingFloatAmount: payload.openingFloat.amount,
        currency: payload.openingFloat.currency,
        businessDate: payload.businessDate,
      };
    }
    case 'CASH_MOVEMENT_CREATED': {
      const payload = schemas.CASH_MOVEMENT_CREATED.parse(event.payload);
      return {
        type: 'CASH_MOVEMENT_CREATED',
        cashMovementId: payload.cashMovementId,
        cashSessionId: payload.cashSessionId,
        movementType: payload.movementType,
        amount: payload.amount.amount,
        currency: payload.amount.currency,
        reason: payload.reason,
        actorUserId: payload.actorUserId,
      };
    }
    case 'CASH_SESSION_CLOSED': {
      const payload = schemas.CASH_SESSION_CLOSED.parse(event.payload);
      const currencies = new Set([
        payload.expectedCash.currency,
        payload.countedCash.currency,
        payload.difference.currency,
      ]);
      if (currencies.size !== 1) throw new Error('Cash closure currencies do not match.');
      return {
        type: 'CASH_SESSION_CLOSED',
        cashSessionId: payload.cashSessionId,
        businessDate: payload.businessDate,
        expectedCashAmount: payload.expectedCash.amount,
        countedCashAmount: payload.countedCash.amount,
        differenceAmount: payload.difference.amount,
        currency: payload.expectedCash.currency,
        closedBy: payload.closedBy,
      };
    }
    default:
      return null;
  }
}
