import { OrderRepository, CatalogRepository } from '@comanview/database';
import { Order, EntityId, OrderType, OrderChannel } from '@comanview/domain';
import { Money } from '@comanview/money';
import { ObjectNotFoundError, ConcurrencyError } from '../../../app/errors.js';
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
  ) {}

  async createOrder(request: CreateOrderRequest): Promise<OrderResponse> {
    const tenantId = EntityId.generate();
    const locationId = EntityId.generate();
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
    return this.mapToResponse(order);
  }

  async getOrder(id: string): Promise<OrderResponse | null> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(id));
    if (!order) return null;
    return this.mapToResponse(order);
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
      return this.mapToResponse(order);
    }

    const product = this.catalogRepo.getProductById(EntityId.fromString(request.productId));
    if (!product) throw new ObjectNotFoundError(`Product ${request.productId} not found`);

    const modifierSelections = new Map<string, EntityId[]>();
    const snapshot = product.createSnapshot(modifierSelections);

    order.addItem(snapshot, request.commandId);

    this.orderRepo.saveOrder(order, true, request.commandId);

    return this.mapToResponse(order);
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
    return this.mapToResponse(order);
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
    return this.mapToResponse(order);
  }

  async closeOrder(orderId: string, request: CloseOrderRequest): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    const balanceDue = Money.fromMinorUnits(request.balanceDueAmount, order.currency);
    order.close(balanceDue);
    this.orderRepo.saveOrder(order, true);
    return this.mapToResponse(order);
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
    return this.mapToResponse(order);
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
    return this.mapToResponse(order);
  }

  private mapToResponse(order: Order): OrderResponse {
    const subtotal = order.getSubtotal();

    return {
      id: order.id.toString(),
      tenantId: order.tenantId.toString(),
      locationId: order.locationId.toString(),
      orderType: order.orderType,
      channel: order.orderChannel,
      currency: order.currency,
      status: order.status,
      tableIds: order.tableIds.map((t) => t.toString()),
      items: order.items.map((i) => ({
        id: i.id.toString(),
        status: i.sendStatus,
        addedAt: order.createdAt.toISOString(),
        sentAt: order.createdAt.toISOString(),
        productSnapshot: {
          productId: i.snapshot.productId.toString(),
          productName: i.snapshot.productName,
          basePrice: {
            amount: i.snapshot.basePrice.amount,
            currency: i.snapshot.basePrice.currency,
          },
          taxRateBasisPoints: i.snapshot.taxRateBasisPoints,
          taxCalculationMode: i.snapshot.taxCalculationMode,
          stationId: i.snapshot.stationId?.toString() ?? null,
          selectedModifiers: i.snapshot.modifiers.map((m) => ({
            modifierOptionId: m.id.toString(),
            name: m.name,
            priceDelta: {
              amount: m.priceDelta.amount,
              currency: m.priceDelta.currency,
            },
          })),
        },
      })),
      rounds: order.rounds.map((r) => ({
        id: r.id.toString(),
        roundNumber: r.roundNumber,
        sentAt: r.sentAt.toISOString(),
        itemIds: [],
      })),
      subtotal: {
        amount: subtotal.amount,
        currency: subtotal.currency,
      },
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.createdAt.toISOString(),
    };
  }
}
