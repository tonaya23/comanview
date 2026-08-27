import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EntityId, RestaurantTable } from '@comanview/domain';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface RestaurantTableRecord {
  table: RestaurantTable;
  activeOrderId: string | null;
  activeOrderNumber: string | null;
}

export class TableRepository {
  constructor(private readonly db: DB) {}

  listOperational(locationId: string): RestaurantTableRecord[] {
    return this.db
      .select({
        table: schema.restaurantTables,
        activeOrderId: schema.orderTableAssignments.orderId,
        activeOrderNumber: schema.orders.orderNumber,
      })
      .from(schema.restaurantTables)
      .leftJoin(
        schema.orderTableAssignments,
        and(
          eq(schema.orderTableAssignments.tableId, schema.restaurantTables.id),
          isNull(schema.orderTableAssignments.releasedAt),
        ),
      )
      .leftJoin(schema.orders, eq(schema.orders.id, schema.orderTableAssignments.orderId))
      .where(eq(schema.restaurantTables.locationId, locationId))
      .orderBy(asc(schema.restaurantTables.zone), asc(schema.restaurantTables.displayOrder))
      .all()
      .map((row) => ({
        table: RestaurantTable.rehydrate({
          id: EntityId.fromString(row.table.id),
          tenantId: EntityId.fromString(row.table.tenantId),
          locationId: EntityId.fromString(row.table.locationId),
          name: row.table.name,
          zone: row.table.zone,
          capacity: row.table.capacity,
          displayOrder: row.table.displayOrder,
          active: row.table.active,
        }),
        activeOrderId: row.activeOrderId,
        activeOrderNumber: row.activeOrderNumber,
      }));
  }

  getByIds(tableIds: readonly string[]): RestaurantTable[] {
    if (tableIds.length === 0) return [];
    const requested = new Set(tableIds);
    return this.db
      .select()
      .from(schema.restaurantTables)
      .all()
      .filter((row) => requested.has(row.id))
      .map((row) =>
        RestaurantTable.rehydrate({
          id: EntityId.fromString(row.id),
          tenantId: EntityId.fromString(row.tenantId),
          locationId: EntityId.fromString(row.locationId),
          name: row.name,
          zone: row.zone,
          capacity: row.capacity,
          displayOrder: row.displayOrder,
          active: row.active,
        }),
      );
  }

  getActiveTableIds(orderId: string): string[] {
    return this.db
      .select({ tableId: schema.orderTableAssignments.tableId })
      .from(schema.orderTableAssignments)
      .where(
        and(
          eq(schema.orderTableAssignments.orderId, orderId),
          isNull(schema.orderTableAssignments.releasedAt),
        ),
      )
      .all()
      .map(({ tableId }) => tableId);
  }

  findOccupant(tableId: string, excludingOrderId?: string): string | null {
    const row = this.db
      .select({ orderId: schema.orderTableAssignments.orderId })
      .from(schema.orderTableAssignments)
      .where(
        and(
          eq(schema.orderTableAssignments.tableId, tableId),
          isNull(schema.orderTableAssignments.releasedAt),
        ),
      )
      .get();
    if (!row || row.orderId === excludingOrderId) return null;
    return row.orderId;
  }
}
