import { OrderRepository, CatalogRepository } from '@comanview/database';
import {
  InvalidModifierSelectionError,
  Order,
  EntityId,
  OrderType,
  OrderChannel,
} from '@comanview/domain';
import { ObjectNotFoundError, ConcurrencyError } from '../../../app/errors.js';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';
import { AppError } from '../../../app/errorHandler.js';
import { mapOrderToResponse } from './orderMapper.js';
import {
  CreateOrderRequest,
  AddOrderItemRequest,
  SendRoundRequest,
  CloseOrderRequest,
  OrderResponse,
  CancelOrderRequest,
  RemoveOrderItemRequest,
  UpdateOrderTablesRequest,
} from '@comanview/contracts';

export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly catalogRepo: CatalogRepository,
    private readonly context: EdgeOperationalContext,
  ) {}

  async createOrder(request: CreateOrderRequest): Promise<OrderResponse> {
    const tenantId = EntityId.fromString(this.context.tenantId);
    const locationId = EntityId.fromString(this.context.locationId);
    const tableIds = request.tableIds ? request.tableIds.map((t) => EntityId.fromString(t)) : [];

    const order = Order.create({
      orderType: request.orderType as OrderType,
      orderChannel: request.channel as OrderChannel,
      orderNumber: Date.now().toString(),
      tenantId,
      locationId,
      tableIds,
      currency: request.currency,
    });

    this.orderRepo.saveOrder(order, true);
    return mapOrderToResponse(order);
  }

  async getOrder(id: string): Promise<OrderResponse | null> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(id));
    if (!order) return null;
    return mapOrderToResponse(order);
  }

  async addItem(orderId: string, request: AddOrderItemRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      return mapOrderToResponse(order);
    }

    const product = this.catalogRepo.getProductById(EntityId.fromString(request.productId));
    if (!product) throw new ObjectNotFoundError(`Product ${request.productId} not found`);

    const modifierSelections = new Map<string, EntityId[]>();
    for (const selectedId of request.selectedModifierIds ?? []) {
      const optionId = EntityId.fromString(selectedId);
      const owningGroup = product.modifierGroups.find((pmg) =>
        pmg.modifierGroup.options.some((option) => option.id.equals(optionId)),
      );
      if (!owningGroup) {
        throw new InvalidModifierSelectionError(
          `ModifierOption ${selectedId} is not assigned to Product ${product.id.toString()}.`,
        );
      }
      const groupId = owningGroup.modifierGroup.id.toString();
      modifierSelections.set(groupId, [...(modifierSelections.get(groupId) ?? []), optionId]);
    }
    const snapshot = product.createSnapshot(modifierSelections);

    order.addItem(snapshot, request.commandId);

    this.orderRepo.saveOrder(order, true, request.commandId);

    return mapOrderToResponse(order);
  }

  async removeItem(
    orderId: string,
    itemId: string,
    request: RemoveOrderItemRequest,
  ): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.removeItem(EntityId.fromString(itemId));
    this.orderRepo.saveOrder(order, true);
    return mapOrderToResponse(order);
  }

  async sendRound(orderId: string, request: SendRoundRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.sendDraftItems();
    this.orderRepo.saveOrder(order, true);
    return mapOrderToResponse(order);
  }

  async closeOrder(orderId: string, request: CloseOrderRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'ORDER_CLOSED') {
        return mapOrderToResponse(order);
      }
      throw new AppError(
        'COMMAND_ID_CONFLICT',
        409,
        'commandId was already used for a different operation.',
      );
    }

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.close(request.commandId);
    this.orderRepo.saveOrder(order, true, request.commandId);
    return mapOrderToResponse(order);
  }

  async cancelOrder(orderId: string, request: CancelOrderRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.cancel();
    this.orderRepo.saveOrder(order, true);
    return mapOrderToResponse(order);
  }

  async updateTables(orderId: string, request: UpdateOrderTablesRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    const tableIds = request.tableIds.map((t) => EntityId.fromString(t));
    order.updateTables(tableIds);

    this.orderRepo.saveOrder(order, true);
    return mapOrderToResponse(order);
  }
}
