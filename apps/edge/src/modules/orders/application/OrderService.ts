import { OrderRepository, CatalogRepository } from '@comanview/database';
import {
  InvalidModifierSelectionError,
  Order,
  OrderItemNotFoundError,
  Product,
  EntityId,
  OrderType,
  OrderChannel,
  normalizeSpecialInstructions,
} from '@comanview/domain';
import { ObjectNotFoundError, ConcurrencyError } from '../../../app/errors.js';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';
import { AppError } from '../../../app/errorHandler.js';
import { mapOrderToResponse } from './orderMapper.js';
import type { PrintService } from '../../printing/application/PrintService.js';
import type { KdsService } from '../../kds/application/KdsService.js';
import {
  CreateOrderRequest,
  AddOrderItemRequest,
  SendRoundRequest,
  CloseOrderRequest,
  OrderResponse,
  CancelOrderRequest,
  RemoveOrderItemRequest,
  UpdateOrderTablesRequest,
  UpdateOrderItemSpecialInstructionsRequest,
  UpdateDraftOrderItemConfigurationRequest,
} from '@comanview/contracts';

export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly catalogRepo: CatalogRepository,
    private readonly context: EdgeOperationalContext,
    private readonly printService: PrintService,
    private readonly kdsService: KdsService,
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

    const snapshot = this.createAuthoritativeSnapshot(product, request.selectedModifierIds ?? []);

    order.addItem(snapshot, request.commandId, request.specialInstructions);

    this.orderRepo.saveOrder(order, true, request.commandId);

    return mapOrderToResponse(order);
  }

  async updateDraftItemConfiguration(
    orderId: string,
    itemId: string,
    request: UpdateDraftOrderItemConfigurationRequest,
  ): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    const requestedModifierIds = [...request.selectedModifierIds].sort();
    const normalizedInstructions = normalizeSpecialInstructions(request.specialInstructions);
    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'ITEM_CONFIGURATION_UPDATED') {
        const payload = JSON.parse(event.payload) as {
          itemId?: string;
          modifierOptionIds?: string[];
          specialInstructions?: string | null;
        };
        if (
          payload.itemId === itemId &&
          JSON.stringify([...(payload.modifierOptionIds ?? [])].sort()) ===
            JSON.stringify(requestedModifierIds) &&
          payload.specialInstructions === normalizedInstructions
        ) {
          return mapOrderToResponse(order);
        }
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

    const item = order.items.find((candidate) => candidate.id.toString() === itemId);
    if (!item) throw new OrderItemNotFoundError(itemId);
    const productId = item.snapshot.productId;
    const product = this.catalogRepo.getProductById(productId);
    if (!product) throw new ObjectNotFoundError(`Product ${productId.toString()} not found`);
    const snapshot = this.createAuthoritativeSnapshot(product, request.selectedModifierIds);

    order.updateDraftItemConfiguration(
      item.id,
      snapshot,
      request.specialInstructions,
      request.commandId,
    );
    this.orderRepo.saveOrder(order, true, request.commandId);
    return mapOrderToResponse(order);
  }

  async updateItemSpecialInstructions(
    orderId: string,
    itemId: string,
    request: UpdateOrderItemSpecialInstructionsRequest,
  ): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (
        event?.aggregateId === orderId &&
        event.eventType === 'ITEM_SPECIAL_INSTRUCTIONS_UPDATED'
      ) {
        const payload = JSON.parse(event.payload) as {
          itemId?: string;
          specialInstructions?: string | null;
        };
        if (
          payload.itemId === itemId &&
          payload.specialInstructions === normalizeSpecialInstructions(request.specialInstructions)
        ) {
          return mapOrderToResponse(order);
        }
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

    order.updateItemSpecialInstructions(
      EntityId.fromString(itemId),
      request.specialInstructions,
      request.commandId,
    );
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

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'ROUND_SENT') {
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

    const round = order.sendDraftItems(request.commandId);
    const jobs = this.printService.createStationJobs(order, round);
    this.orderRepo.saveOrder(order, true, request.commandId, jobs);
    this.kdsService.notifyRoundSent(order, round);
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

  private createAuthoritativeSnapshot(product: Product, selectedModifierIds: string[]) {
    const modifierSelections = new Map<string, EntityId[]>();
    for (const selectedId of selectedModifierIds) {
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
    return product.createSnapshot(modifierSelections);
  }
}
