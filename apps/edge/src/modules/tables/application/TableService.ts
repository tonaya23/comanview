import type { RestaurantTableResponse } from '@comanview/contracts';
import type { TableRepository } from '@comanview/database';
import type { OrderRepository } from '@comanview/database';
import { EntityId, deriveTableOperationalStatus, type Order } from '@comanview/domain';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';

export class TableService {
  constructor(
    private readonly repository: TableRepository,
    private readonly orderRepository: OrderRepository,
    private readonly context: EdgeOperationalContext,
  ) {}

  list(): RestaurantTableResponse[] {
    const orders = new Map<string, Order>();
    return this.repository.listOperational(this.context.locationId).map((record) => {
      const order = record.activeOrderId
        ? (orders.get(record.activeOrderId) ??
          this.orderRepository.getOrderById(EntityId.fromString(record.activeOrderId)))
        : null;
      if (record.activeOrderId && order) orders.set(record.activeOrderId, order);
      const sentItems = order?.items.filter((item) => item.sendStatus === 'SENT') ?? [];
      const pendingItemCount = sentItems.filter((item) => item.prepStatus === 'PENDING').length;
      const preparingItemCount = sentItems.filter((item) => item.prepStatus === 'PREPARING').length;
      const readyItemCount = sentItems.filter((item) => item.prepStatus === 'READY').length;
      const status = deriveTableOperationalStatus({
        hasActiveOrder: Boolean(order),
        hasReadyItems: readyItemCount > 0,
        paymentRequested: Boolean(order?.paymentRequestedAt),
      });
      return {
        id: record.table.id.toString(),
        locationId: record.table.locationId.toString(),
        name: record.table.name,
        zone: record.table.zone,
        capacity: record.table.capacity,
        displayOrder: record.table.displayOrder,
        active: record.table.active,
        status,
        activeOrderId: record.activeOrderId,
        activeOrderNumber: record.activeOrderNumber,
        activeOrderCreatedAt: order?.createdAt.toISOString() ?? null,
        paymentRequestedAt: order?.paymentRequestedAt?.toISOString() ?? null,
        pendingItemCount,
        preparingItemCount,
        readyItemCount,
        draftItemCount: order?.items.filter((item) => item.sendStatus === 'DRAFT').length ?? 0,
        total: order?.getSubtotal().toJSON() ?? null,
        balanceDue: order?.getBalanceDue().toJSON() ?? null,
      };
    });
  }
}
