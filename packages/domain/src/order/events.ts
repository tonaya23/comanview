import { EntityId } from '../shared/EntityId.js';
import { OrderType, OrderChannel, OrderStatus } from './types.js';

/**
 * Base interface for all Order domain events.
 * commandId is stored for future idempotency enforcement at the infrastructure layer.
 */
export interface OrderDomainEvent {
  readonly eventId: EntityId;
  readonly eventType: string;
  readonly orderId: EntityId;
  readonly occurredAt: Date;
  readonly commandId: string | null;
}

export interface OrderCreatedEvent extends OrderDomainEvent {
  readonly eventType: 'ORDER_CREATED';
  readonly orderType: OrderType;
  readonly orderChannel: OrderChannel;
  readonly tenantId: EntityId;
  readonly locationId: EntityId;
  readonly tableIds: EntityId[];
}

export interface OrderItemAddedEvent extends OrderDomainEvent {
  readonly eventType: 'ITEM_ADDED';
  readonly itemId: EntityId;
  readonly productName: string;
  readonly specialInstructions: string | null;
}

export interface OrderItemRemovedEvent extends OrderDomainEvent {
  readonly eventType: 'ITEM_REMOVED';
  readonly itemId: EntityId;
}

export interface OrderItemSpecialInstructionsUpdatedEvent extends OrderDomainEvent {
  readonly eventType: 'ITEM_SPECIAL_INSTRUCTIONS_UPDATED';
  readonly itemId: EntityId;
  readonly specialInstructions: string | null;
}

export interface OrderItemConfigurationUpdatedEvent extends OrderDomainEvent {
  readonly eventType: 'ITEM_CONFIGURATION_UPDATED';
  readonly itemId: EntityId;
  readonly productId: EntityId;
  readonly modifierOptionIds: EntityId[];
  readonly specialInstructions: string | null;
}

export interface RoundSentEvent extends OrderDomainEvent {
  readonly eventType: 'ROUND_SENT';
  readonly roundId: EntityId;
  readonly itemIds: EntityId[];
}

export interface OrderClosedEvent extends OrderDomainEvent {
  readonly eventType: 'ORDER_CLOSED';
}

export interface OrderCancelledEvent extends OrderDomainEvent {
  readonly eventType: 'ORDER_CANCELLED';
}

export interface TablesUpdatedEvent extends OrderDomainEvent {
  readonly eventType: 'TABLES_UPDATED';
  readonly tableIds: EntityId[];
}

export interface PaymentCompletedEvent extends OrderDomainEvent {
  readonly eventType: 'PAYMENT_COMPLETED';
  readonly paymentId: EntityId;
  readonly cashSessionId: EntityId;
  readonly method: 'CASH' | 'CARD' | 'OTHER';
  readonly amountApplied: number;
  readonly tipAmount: number;
  readonly currency: string;
}

export interface PaymentVoidedEvent extends OrderDomainEvent {
  readonly eventType: 'PAYMENT_VOIDED';
  readonly paymentId: EntityId;
}

export type AnyOrderEvent =
  | OrderCreatedEvent
  | OrderItemAddedEvent
  | OrderItemRemovedEvent
  | OrderItemSpecialInstructionsUpdatedEvent
  | OrderItemConfigurationUpdatedEvent
  | RoundSentEvent
  | OrderClosedEvent
  | OrderCancelledEvent
  | TablesUpdatedEvent
  | PaymentCompletedEvent
  | PaymentVoidedEvent;
