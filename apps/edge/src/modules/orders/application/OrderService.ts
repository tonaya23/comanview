import {
  OrderRepository,
  CatalogRepository,
  TableRepository,
  AuditPersistenceError,
  type NewAuditEntry,
} from '@comanview/database';
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
import type { RealtimeHub } from '../../../infrastructure/realtime/RealtimeHub.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';
import type { EdgeLicenseManager } from '../../licensing/EdgeLicenseManager.js';
import {
  CreateOrderRequest,
  AddOrderItemRequest,
  SendRoundRequest,
  CloseOrderRequest,
  OrderResponse,
  CancelOrderRequest,
  CancelEmptyTableOrderRequest,
  RemoveOrderItemRequest,
  UpdateOrderTablesRequest,
  UpdateOrderItemSpecialInstructionsRequest,
  UpdateDraftOrderItemConfigurationRequest,
  RequestOrderPaymentRequest,
  type OrderRealtimeMessage,
  type TablesRealtimeMessage,
} from '@comanview/contracts';

export class OrderService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly catalogRepo: CatalogRepository,
    private readonly context: EdgeOperationalContext,
    private readonly printService: PrintService,
    private readonly kdsService: KdsService,
    private readonly tableRepo: TableRepository,
    private readonly realtime: RealtimeHub,
    private readonly licensing?: EdgeLicenseManager,
  ) {}

  async createOrder(
    request: CreateOrderRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
    if (request.commandId && this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.eventType === 'ORDER_CREATED') {
        const existing = this.orderRepo.getOrderById(EntityId.fromString(event.aggregateId));
        if (existing) return mapOrderToResponse(existing);
      }
      throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used.');
    }
    this.licensing?.assertAllowed('ORDER_CREATE', request.orderType === 'TABLE' ? 'TABLE_SERVICE' : 'CORE_POS');
    const tenantId = EntityId.fromString(this.context.tenantId);
    const locationId = EntityId.fromString(this.context.locationId);
    const requestedTableIds = request.tableIds ?? [];
    this.assertTablesAssignable(requestedTableIds);
    const tableIds = requestedTableIds.map((t) => EntityId.fromString(t));

    const order = Order.create({
      orderType: request.orderType as OrderType,
      orderChannel: request.channel as OrderChannel,
      orderNumber: Date.now().toString(),
      tenantId,
      locationId,
      tableIds,
      currency: request.currency,
      ...(request.commandId ? { commandId: request.commandId } : {}),
    });

    this.saveWithTableConflictMapping(order, request.commandId);
    this.notifyOrder(order, 'ORDER_CREATED', 'ORDER_OPENED');
    return mapOrderToResponse(order);
  }

  async getOrder(id: string): Promise<OrderResponse | null> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(id));
    if (!order) return null;
    return mapOrderToResponse(order);
  }

  async addItem(
    orderId: string,
    request: AddOrderItemRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
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
    this.licensing?.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', orderId);

    const product = this.catalogRepo.getProductById(EntityId.fromString(request.productId));
    if (!product) throw new ObjectNotFoundError(`Product ${request.productId} not found`);

    const snapshot = this.createAuthoritativeSnapshot(product, request.selectedModifierIds ?? []);

    order.addItem(snapshot, request.commandId, request.specialInstructions);

    this.orderRepo.saveOrder(order, true, request.commandId);
    this.notifyOrder(order, 'ITEM_ADDED');

    return mapOrderToResponse(order);
  }

  async updateDraftItemConfiguration(
    orderId: string,
    itemId: string,
    request: UpdateDraftOrderItemConfigurationRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
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
    this.licensing?.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', orderId);

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
    this.notifyOrder(order, 'ITEM_CONFIGURATION_UPDATED');
    return mapOrderToResponse(order);
  }

  async updateItemSpecialInstructions(
    orderId: string,
    itemId: string,
    request: UpdateOrderItemSpecialInstructionsRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
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
    this.licensing?.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', orderId);

    order.updateItemSpecialInstructions(
      EntityId.fromString(itemId),
      request.specialInstructions,
      request.commandId,
    );
    this.orderRepo.saveOrder(order, true, request.commandId);
    this.notifyOrder(order, 'ITEM_SPECIAL_INSTRUCTIONS_UPDATED');
    return mapOrderToResponse(order);
  }

  async removeItem(
    orderId: string,
    itemId: string,
    request: RemoveOrderItemRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);
    this.licensing?.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', orderId);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.removeItem(EntityId.fromString(itemId));
    this.orderRepo.saveOrder(order, true);
    this.notifyOrder(order, 'ITEM_REMOVED');
    return mapOrderToResponse(order);
  }

  async sendRound(
    orderId: string,
    request: SendRoundRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
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
    this.licensing?.assertAllowed('ORDER_SEND', 'CORE_POS', orderId);

    const round = order.sendDraftItems(request.commandId);
    const jobs = this.printService.createStationJobs(order, round);
    this.orderRepo.saveOrder(order, true, request.commandId, jobs);
    this.kdsService.notifyRoundSent(order, round);
    this.notifyOrder(order, 'ROUND_SENT');
    return mapOrderToResponse(order);
  }

  async closeOrder(
    orderId: string,
    request: CloseOrderRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
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
    this.licensing?.assertAllowed('ORDER_CLOSE', 'CORE_POS', orderId);

    order.close(request.commandId);
    const releasedTableIds = order.tableIds.map((tableId) => tableId.toString());
    this.saveWithTableConflictMapping(order, request.commandId);
    this.notifyOrder(order, 'ORDER_CLOSED', 'ORDER_RELEASED', releasedTableIds);
    return mapOrderToResponse(order);
  }

  async cancelOrder(
    orderId: string,
    request: CancelOrderRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);
    this.licensing?.assertAllowed('ORDER_CANCEL', 'CORE_POS', orderId);

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.cancel();
    const releasedTableIds = order.tableIds.map((tableId) => tableId.toString());
    this.saveWithTableConflictMapping(order);
    this.notifyOrder(order, 'ORDER_CANCELLED', 'ORDER_RELEASED', releasedTableIds);
    return mapOrderToResponse(order);
  }

  async cancelEmptyTableOrder(
    orderId: string,
    request: CancelEmptyTableOrderRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);
    this.licensing?.assertAllowed('ORDER_CANCEL', 'TABLE_SERVICE', orderId);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'ORDER_CANCELLED') {
        return mapOrderToResponse(order);
      }
      throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used.');
    }

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    const releasedTableIds = order.tableIds.map((tableId) => tableId.toString());
    const before = { status: order.status, tableIds: releasedTableIds };
    order.cancelEmptyTable(request.commandId);
    const event = order.events.find(
      (candidate) =>
        candidate.eventType === 'ORDER_CANCELLED' && candidate.commandId === request.commandId,
    );
    const audit: NewAuditEntry = {
      auditId: EntityId.generate().toString(),
      occurredAt: operation.requestedAt,
      tenantId: operation.actor.tenantId,
      locationId: operation.actor.locationId,
      deviceId: operation.actor.deviceId,
      sessionId: operation.actor.sessionId,
      actorUserId: operation.actor.userId,
      actorRole: operation.actor.roles[0] ?? null,
      authorizedByUserId: operation.authorizedBy?.userId ?? null,
      authorizedByRole: operation.authorizedBy?.roles[0] ?? null,
      action: 'ORDER_EMPTY_CANCELLED',
      entityType: 'ORDER',
      entityId: orderId,
      outcome: 'SUCCESS',
      reason: 'EMPTY_TABLE_RELEASED',
      commandId: request.commandId,
      before,
      after: { status: 'CANCELLED', tableIds: releasedTableIds },
      amountAffected: null,
      currency: order.currency,
      eventId: event?.eventId.toString() ?? null,
    };
    try {
      this.orderRepo.saveOrder(order, true, request.commandId, [], [audit]);
    } catch (error) {
      if (error instanceof AuditPersistenceError) {
        throw new AppError(
          'AUDIT_PERSISTENCE_FAILED',
          500,
          'The required audit record could not be persisted.',
        );
      }
      throw error;
    }
    this.notifyOrder(order, 'ORDER_CANCELLED', 'ORDER_RELEASED', releasedTableIds);
    return mapOrderToResponse(order);
  }

  async updateTables(
    orderId: string,
    request: UpdateOrderTablesRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'TABLES_UPDATED') {
        const payload = JSON.parse(event.payload) as { tableIds?: string[] };
        if (
          JSON.stringify([...(payload.tableIds ?? [])].sort()) ===
          JSON.stringify([...request.tableIds].sort())
        )
          return mapOrderToResponse(order);
      }
      throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used.');
    }

    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    this.licensing?.assertAllowed('ORDER_ADD_ITEM', 'TABLE_SERVICE', orderId);

    this.assertTablesAssignable(request.tableIds, orderId);
    const previousTableIds = order.tableIds.map((tableId) => tableId.toString());
    const tableIds = request.tableIds.map((t) => EntityId.fromString(t));
    order.updateTables(tableIds, request.commandId);

    this.saveWithTableConflictMapping(order, request.commandId);
    this.notifyOrder(
      order,
      'TABLES_UPDATED',
      'TABLES_UPDATED',
      [...new Set([...previousTableIds, ...request.tableIds])],
    );
    return mapOrderToResponse(order);
  }

  async requestPayment(
    orderId: string,
    request: RequestOrderPaymentRequest,
    operation: AuthorizedOperation,
  ): Promise<OrderResponse> {
    void operation;
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      if (event?.aggregateId === orderId && event.eventType === 'PAYMENT_REQUESTED') {
        return mapOrderToResponse(order);
      }
      throw new AppError('COMMAND_ID_CONFLICT', 409, 'commandId was already used.');
    }
    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }
    this.licensing?.assertAllowed('ORDER_SEND', 'CORE_POS', orderId);
    if (order.paymentRequestedAt) return mapOrderToResponse(order);

    order.requestPayment(request.commandId);
    this.orderRepo.saveOrder(order, true, request.commandId);
    this.notifyOrder(order, 'PAYMENT_REQUESTED', 'PAYMENT_REQUESTED');
    return mapOrderToResponse(order);
  }

  private assertTablesAssignable(tableIds: readonly string[], excludingOrderId?: string): void {
    if (tableIds.length === 0) return;
    const uniqueIds = [...new Set(tableIds)];
    const tables = this.tableRepo.getByIds(uniqueIds);
    for (const tableId of uniqueIds) {
      const table = tables.find((candidate) => candidate.id.toString() === tableId);
      if (!table || table.locationId.toString() !== this.context.locationId) {
        throw new AppError('TABLE_NOT_FOUND', 404, `Table ${tableId} was not found.`);
      }
      if (!table.active) {
        throw new AppError('TABLE_INACTIVE', 409, `Table ${tableId} is inactive.`);
      }
      const occupant = this.tableRepo.findOccupant(tableId, excludingOrderId);
      if (occupant) {
        throw new AppError('TABLE_OCCUPIED', 409, `Table ${tableId} is already occupied.`, {
          tableId,
          activeOrderId: occupant,
        });
      }
    }
  }

  private saveWithTableConflictMapping(order: Order, commandId?: string): void {
    try {
      this.orderRepo.saveOrder(order, true, commandId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('unq_active_table_assignment') ||
        message.includes('order_table_assignments.table_id')
      ) {
        throw new AppError(
          'TABLE_OCCUPIED',
          409,
          'One of the selected tables is already occupied.',
        );
      }
      throw error;
    }
  }

  private notifyTables(
    orderId: string,
    tableIds: string[],
    reason: TablesRealtimeMessage['reason'],
  ): void {
    this.realtime.publish({
      type: 'TABLES_CHANGED',
      locationId: this.context.locationId,
      tableIds,
      orderId,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }

  private notifyOrder(
    order: Order,
    reason: OrderRealtimeMessage['reason'],
    tableReason: TablesRealtimeMessage['reason'] = 'ORDER_UPDATED',
    affectedTableIds = order.tableIds.map((tableId) => tableId.toString()),
  ): void {
    this.realtime.publish({
      type: 'ORDER_UPDATED',
      locationId: order.locationId.toString(),
      orderId: order.id.toString(),
      version: order.version,
      reason,
      occurredAt: new Date().toISOString(),
    });
    if (order.orderType === 'TABLE' && affectedTableIds.length > 0) {
      this.notifyTables(order.id.toString(), affectedTableIds, tableReason);
    }
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
