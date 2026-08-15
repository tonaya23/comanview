import { EntityId } from '../shared/EntityId.js';
import { OrderType, OrderChannel, OrderStatus } from './types.js';

/**
 * Base interface for all Order domain events.
 * commandId is stored for future idempotency enforcement at the infrastructure layer.
 */
export interface OrderDomainEvent {
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
}

export interface OrderItemRemovedEvent extends OrderDomainEvent {
  readonly eventType: 'ITEM_REMOVED';
  readonly itemId: EntityId;
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

export type AnyOrderEvent =
  | OrderCreatedEvent
  | OrderItemAddedEvent
  | OrderItemRemovedEvent
  | RoundSentEvent
  | OrderClosedEvent
  | OrderCancelledEvent
  | TablesUpdatedEvent;
