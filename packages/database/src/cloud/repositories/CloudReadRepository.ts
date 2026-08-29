import type { Pool, QueryResultRow } from 'pg';

interface ReadRow extends QueryResultRow {
  tenant_id: string;
  location_id: string;
  edge_id: string | null;
  heartbeat_status: string | null;
  last_seen_at: Date | null;
  reported_at: Date | null;
  edge_version: string | null;
  schema_version: string | null;
  pending_event_count: number | null;
  active_dead_letter_count: number;
  stalled_event_count: number;
  incomplete_sale_count: number;
  checkpoint_degraded: boolean;
  last_event_received_at: Date | null;
  last_projection_processed_at: Date | null;
  order_id: string;
  order_type: string;
  order_channel: string;
  status: string;
  table_ids: string[];
  payment_requested_at: Date | null;
  item_count: number;
  sent_item_count: number;
  paid_amount: string | number;
  tip_amount: string | number;
  currency: string | null;
  created_at: Date;
  closed_at: Date | null;
  cancelled_at: Date | null;
  payment_id: string;
  cash_session_id: string;
  cash_register_id: string;
  method: string;
  amount_applied: string | number;
  completed_at: Date;
  voided_at: Date | null;
  sale_amount: string | number;
  charged_total: string | number;
  completeness_status: string;
  business_date: string;
  opening_float_amount: string | number;
  cash_in_amount: string | number;
  cash_out_amount: string | number;
  expected_cash_amount: string | number | null;
  counted_cash_amount: string | number | null;
  difference_amount: string | number | null;
  opened_at: Date;
  closed_by: string | null;
  cash_movement_id: string;
  movement_type: string;
  amount: string | number;
  reason: string;
  actor_user_id: string;
  occurred_at: Date;
}

export interface CloudAdminAccessScope {
  global: boolean;
  tenantIds: string[];
}

export interface ScopedLocation {
  tenantId: string;
  locationId: string;
  edgeId: string;
}

export interface PageCursor {
  timestamp: Date;
  id: string;
}

export interface CloudReadPage<T> {
  data: T[];
  hasMore: boolean;
}

export interface LocationOperationalRecord {
  tenantId: string;
  locationId: string;
  edgeId: string | null;
  heartbeatStatus: string | null;
  lastSeenAt: Date | null;
  reportedAt: Date | null;
  edgeVersion: string | null;
  schemaVersion: string | null;
  pendingEventCount: number | null;
  activeDeadLetterCount: number;
  stalledEventCount: number;
  incompleteSaleCount: number;
  checkpointDegraded: boolean;
  lastEventReceivedAt: Date | null;
  lastProjectionProcessedAt: Date | null;
}

export interface OrderReadRecord extends ScopedLocation {
  orderId: string;
  orderType: string;
  orderChannel: string;
  status: string;
  tableIds: string[];
  paymentRequestedAt: Date | null;
  itemCount: number;
  sentItemCount: number;
  paidAmount: number;
  tipAmount: number;
  currency: string | null;
  createdAt: Date;
  closedAt: Date | null;
  cancelledAt: Date | null;
}

export interface PaymentReadRecord extends ScopedLocation {
  paymentId: string;
  orderId: string;
  cashSessionId: string;
  method: string;
  amountApplied: number;
  tipAmount: number;
  currency: string;
  status: string;
  completedAt: Date;
  voidedAt: Date | null;
}

export interface SaleReadRecord extends ScopedLocation {
  orderId: string;
  saleAmount: number;
  tipAmount: number;
  chargedTotal: number;
  currency: string | null;
  completenessStatus: string;
  closedAt: Date;
}

export interface CashSessionReadRecord extends ScopedLocation {
  cashSessionId: string;
  cashRegisterId: string;
  businessDate: string;
  currency: string;
  status: string;
  openingFloatAmount: number;
  cashInAmount: number;
  cashOutAmount: number;
  expectedCashAmount: number | null;
  countedCashAmount: number | null;
  differenceAmount: number | null;
  openedAt: Date;
  closedAt: Date | null;
  closedBy: string | null;
}

export interface CashMovementReadRecord extends ScopedLocation {
  cashMovementId: string;
  cashSessionId: string;
  movementType: string;
  amount: number;
  currency: string;
  reason: string;
  actorUserId: string;
  occurredAt: Date;
}

export interface FinancialTotalRecord {
  currency: string;
  saleAmount: number;
  tipAmount: number;
  chargedTotal: number;
}

export class CloudReadRepository {
  constructor(
    private readonly pool: Pool,
    private readonly projectionVersion: number,
  ) {}

  async listLocations(input: {
    scope: CloudAdminAccessScope;
    afterLocationId?: string | undefined;
    limit: number;
    lagCutoff: Date;
  }): Promise<CloudReadPage<LocationOperationalRecord>> {
    const result = await this.pool.query<ReadRow>(
      `SELECT l.tenant_id, l.location_id, e.edge_id,
              hb.status AS heartbeat_status, hb.last_seen_at, hb.reported_at,
              hb.edge_version, hb.schema_version, hb.pending_event_count,
              (SELECT count(*)::int FROM cloud_projection_event_receipts r
               WHERE r.projection_name = 'operational_summaries'
                 AND r.projection_version = $3 AND r.edge_id = e.edge_id
                 AND r.outcome = 'DEAD_LETTER') AS active_dead_letter_count,
              (SELECT count(*)::int FROM cloud_sync_inbox i
               WHERE i.edge_id = e.edge_id AND i.received_at <= $4
                 AND i.processing_status IN ('RECEIVED','RETRY','PROCESSING')
                 AND NOT EXISTS (
                   SELECT 1 FROM cloud_projection_event_receipts r
                   WHERE r.projection_name = 'operational_summaries'
                     AND r.projection_version = $3 AND r.event_id = i.event_id
                 )) AS stalled_event_count,
              (SELECT count(*)::int FROM cloud_closed_sale_summaries s
               WHERE s.projection_version = $3 AND s.tenant_id = l.tenant_id
                 AND s.location_id = l.location_id AND s.completeness_status = 'INCOMPLETE')
                AS incomplete_sale_count,
              EXISTS (
                SELECT 1 FROM cloud_projection_checkpoints c
                WHERE c.projection_name = 'operational_summaries'
                  AND c.projection_version = $3 AND c.edge_id = e.edge_id AND c.degraded
              ) AS checkpoint_degraded,
              (SELECT max(i.received_at) FROM cloud_sync_inbox i WHERE i.edge_id = e.edge_id)
                AS last_event_received_at,
              (SELECT max(r.processed_at) FROM cloud_projection_event_receipts r
               WHERE r.projection_name = 'operational_summaries'
                 AND r.projection_version = $3 AND r.edge_id = e.edge_id)
                AS last_projection_processed_at
       FROM cloud_locations l
       LEFT JOIN LATERAL (
         SELECT edge_id, tenant_id, location_id FROM edges
         WHERE location_id = l.location_id AND status = 'ACTIVE'
         ORDER BY activated_at DESC NULLS LAST LIMIT 1
       ) e ON true
       LEFT JOIN edge_heartbeats hb ON hb.edge_id = e.edge_id
       WHERE ($1::boolean OR l.tenant_id = ANY($2::uuid[]))
         AND ($5::uuid IS NULL OR l.location_id < $5)
       ORDER BY l.location_id DESC
       LIMIT $6`,
      [
        input.scope.global,
        input.scope.tenantIds,
        this.projectionVersion,
        input.lagCutoff,
        input.afterLocationId ?? null,
        input.limit + 1,
      ],
    );
    return page(result.rows.map(mapLocation), input.limit);
  }

  async getLocation(
    locationId: string,
    scope: CloudAdminAccessScope,
    lagCutoff: Date,
  ): Promise<LocationOperationalRecord | null> {
    const pageResult = await this.pool.query<ReadRow>(
      `SELECT l.tenant_id, l.location_id, e.edge_id,
              hb.status AS heartbeat_status, hb.last_seen_at, hb.reported_at,
              hb.edge_version, hb.schema_version, hb.pending_event_count,
              (SELECT count(*)::int FROM cloud_projection_event_receipts r
               WHERE r.projection_name = 'operational_summaries' AND r.projection_version = $4
                 AND r.edge_id = e.edge_id AND r.outcome = 'DEAD_LETTER') AS active_dead_letter_count,
              (SELECT count(*)::int FROM cloud_sync_inbox i
               WHERE i.edge_id = e.edge_id AND i.received_at <= $5
                 AND i.processing_status IN ('RECEIVED','RETRY','PROCESSING')
                 AND NOT EXISTS (SELECT 1 FROM cloud_projection_event_receipts r
                   WHERE r.projection_name = 'operational_summaries'
                     AND r.projection_version = $4 AND r.event_id = i.event_id)) AS stalled_event_count,
              (SELECT count(*)::int FROM cloud_closed_sale_summaries s
               WHERE s.projection_version = $4 AND s.tenant_id = l.tenant_id
                 AND s.location_id = l.location_id AND s.completeness_status = 'INCOMPLETE')
                AS incomplete_sale_count,
              EXISTS (SELECT 1 FROM cloud_projection_checkpoints c
               WHERE c.projection_name = 'operational_summaries' AND c.projection_version = $4
                 AND c.edge_id = e.edge_id AND c.degraded) AS checkpoint_degraded,
              (SELECT max(i.received_at) FROM cloud_sync_inbox i WHERE i.edge_id = e.edge_id)
                AS last_event_received_at,
              (SELECT max(r.processed_at) FROM cloud_projection_event_receipts r
               WHERE r.projection_name = 'operational_summaries' AND r.projection_version = $4
                 AND r.edge_id = e.edge_id) AS last_projection_processed_at
       FROM cloud_locations l
       LEFT JOIN LATERAL (
         SELECT edge_id FROM edges WHERE location_id = l.location_id AND status = 'ACTIVE'
         ORDER BY activated_at DESC NULLS LAST LIMIT 1
       ) e ON true
       LEFT JOIN edge_heartbeats hb ON hb.edge_id = e.edge_id
       WHERE l.location_id = $1
         AND ($2::boolean OR l.tenant_id = ANY($3::uuid[]))`,
      [locationId, scope.global, scope.tenantIds, this.projectionVersion, lagCutoff],
    );
    return pageResult.rows[0] ? mapLocation(pageResult.rows[0]) : null;
  }

  async getOrderCounts(location: ScopedLocation) {
    const result = await this.pool.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM cloud_order_operational_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
       GROUP BY status`,
      [this.projectionVersion, location.tenantId, location.locationId],
    );
    const counts = { open: 0, closed: 0, cancelled: 0 };
    for (const row of result.rows) {
      if (row.status === 'OPEN') counts.open = row.count;
      if (row.status === 'CLOSED') counts.closed = row.count;
      if (row.status === 'CANCELLED') counts.cancelled = row.count;
    }
    return counts;
  }

  async getCompleteSalesTotals(
    location: ScopedLocation,
    from: Date,
    to: Date,
  ): Promise<FinancialTotalRecord[]> {
    const result = await this.pool.query<{
      currency: string;
      sale_amount: string;
      tip_amount: string;
      charged_total: string;
    }>(
      `SELECT currency, sum(sale_amount)::text AS sale_amount,
              sum(tip_amount)::text AS tip_amount, sum(charged_total)::text AS charged_total
       FROM cloud_closed_sale_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         AND completeness_status = 'COMPLETE' AND currency IS NOT NULL
         AND closed_at >= $4 AND closed_at < $5
       GROUP BY currency ORDER BY currency`,
      [this.projectionVersion, location.tenantId, location.locationId, from, to],
    );
    return result.rows.map((row) => ({
      currency: row.currency,
      saleAmount: exactNumber(row.sale_amount),
      tipAmount: exactNumber(row.tip_amount),
      chargedTotal: exactNumber(row.charged_total),
    }));
  }

  async countIncompleteSales(location: ScopedLocation, from: Date, to: Date): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM cloud_closed_sale_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         AND completeness_status = 'INCOMPLETE' AND closed_at >= $4 AND closed_at < $5`,
      [this.projectionVersion, location.tenantId, location.locationId, from, to],
    );
    return result.rows[0]?.count ?? 0;
  }

  async listOrders(input: {
    location: ScopedLocation;
    limit: number;
    cursor?: PageCursor | undefined;
    status?: string | undefined;
    orderType?: string | undefined;
    orderChannel?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): Promise<CloudReadPage<OrderReadRecord>> {
    const values: unknown[] = [
      this.projectionVersion,
      input.location.tenantId,
      input.location.locationId,
    ];
    const filters = buildFilters(values, [
      ['status =', input.status],
      ['order_type =', input.orderType],
      ['order_channel =', input.orderChannel],
      ['created_at >=', input.from],
      ['created_at <', input.to],
    ]);
    if (input.cursor) {
      values.push(input.cursor.timestamp, input.cursor.id);
      filters.push(`(created_at, order_id) < ($${values.length - 1}, $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_order_operational_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         ${filters.map((filter) => `AND ${filter}`).join(' ')}
       ORDER BY created_at DESC, order_id DESC LIMIT $${values.length}`,
      values,
    );
    return page(result.rows.map(mapOrder), input.limit);
  }

  async getOrder(location: ScopedLocation, orderId: string): Promise<OrderReadRecord | null> {
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_order_operational_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3 AND order_id = $4`,
      [this.projectionVersion, location.tenantId, location.locationId, orderId],
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async listPayments(input: {
    location: ScopedLocation;
    limit: number;
    cursor?: PageCursor | undefined;
    status?: string | undefined;
    method?: string | undefined;
    orderId?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): Promise<CloudReadPage<PaymentReadRecord>> {
    const values: unknown[] = [this.projectionVersion, input.location.tenantId, input.location.locationId];
    const filters = buildFilters(values, [
      ['status =', input.status], ['method =', input.method], ['order_id =', input.orderId],
      ['completed_at >=', input.from], ['completed_at <', input.to],
    ]);
    if (input.cursor) {
      values.push(input.cursor.timestamp, input.cursor.id);
      filters.push(`(completed_at, payment_id) < ($${values.length - 1}, $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_payment_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         ${filters.map((filter) => `AND ${filter}`).join(' ')}
       ORDER BY completed_at DESC, payment_id DESC LIMIT $${values.length}`,
      values,
    );
    return page(result.rows.map(mapPayment), input.limit);
  }

  async listSales(input: {
    location: ScopedLocation;
    limit: number;
    cursor?: PageCursor | undefined;
    completenessStatus?: string | undefined;
    currency?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): Promise<CloudReadPage<SaleReadRecord>> {
    const values: unknown[] = [this.projectionVersion, input.location.tenantId, input.location.locationId];
    const filters = buildFilters(values, [
      ['completeness_status =', input.completenessStatus], ['currency =', input.currency],
      ['closed_at >=', input.from], ['closed_at <', input.to],
    ]);
    if (input.cursor) {
      values.push(input.cursor.timestamp, input.cursor.id);
      filters.push(`(closed_at, order_id) < ($${values.length - 1}, $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_closed_sale_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         ${filters.map((filter) => `AND ${filter}`).join(' ')}
       ORDER BY closed_at DESC, order_id DESC LIMIT $${values.length}`,
      values,
    );
    return page(result.rows.map(mapSale), input.limit);
  }

  async listCashSessions(input: {
    location: ScopedLocation;
    limit: number;
    cursor?: PageCursor | undefined;
    status?: string | undefined;
    businessDate?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): Promise<CloudReadPage<CashSessionReadRecord>> {
    const values: unknown[] = [this.projectionVersion, input.location.tenantId, input.location.locationId];
    const filters = buildFilters(values, [
      ['status =', input.status], ['business_date =', input.businessDate],
      ['opened_at >=', input.from], ['opened_at <', input.to],
    ]);
    if (input.cursor) {
      values.push(input.cursor.timestamp, input.cursor.id);
      filters.push(`(opened_at, cash_session_id) < ($${values.length - 1}, $${values.length})`);
    }
    values.push(input.limit + 1);
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_cash_session_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         ${filters.map((filter) => `AND ${filter}`).join(' ')}
       ORDER BY opened_at DESC, cash_session_id DESC LIMIT $${values.length}`,
      values,
    );
    return page(result.rows.map(mapCashSession), input.limit);
  }

  async getCurrentOrLatestCashSession(
    location: ScopedLocation,
  ): Promise<CashSessionReadRecord | null> {
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_cash_session_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
       ORDER BY (status = 'OPEN') DESC, opened_at DESC, cash_session_id DESC LIMIT 1`,
      [this.projectionVersion, location.tenantId, location.locationId],
    );
    return result.rows[0] ? mapCashSession(result.rows[0]) : null;
  }

  async getCashSession(
    location: ScopedLocation,
    cashSessionId: string,
  ): Promise<CashSessionReadRecord | null> {
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_cash_session_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         AND cash_session_id = $4`,
      [this.projectionVersion, location.tenantId, location.locationId, cashSessionId],
    );
    return result.rows[0] ? mapCashSession(result.rows[0]) : null;
  }

  async listCashMovements(input: {
    location: ScopedLocation;
    cashSessionId: string;
    limit: number;
    cursor?: PageCursor | undefined;
  }): Promise<CloudReadPage<CashMovementReadRecord>> {
    const values: unknown[] = [
      this.projectionVersion, input.location.tenantId, input.location.locationId, input.cashSessionId,
    ];
    const cursorFilter = input.cursor
      ? (() => {
          values.push(input.cursor!.timestamp, input.cursor!.id);
          return `AND (occurred_at, cash_movement_id) < ($5, $6)`;
        })()
      : '';
    values.push(input.limit + 1);
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_cash_movements
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3
         AND cash_session_id = $4 ${cursorFilter}
       ORDER BY occurred_at DESC, cash_movement_id DESC LIMIT $${values.length}`,
      values,
    );
    return page(result.rows.map(mapCashMovement), input.limit);
  }

  async getPaymentsForOrder(location: ScopedLocation, orderId: string) {
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_payment_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3 AND order_id = $4
       ORDER BY completed_at, payment_id`,
      [this.projectionVersion, location.tenantId, location.locationId, orderId],
    );
    return result.rows.map(mapPayment);
  }

  async getSaleForOrder(location: ScopedLocation, orderId: string) {
    const result = await this.pool.query<ReadRow>(
      `SELECT * FROM cloud_closed_sale_summaries
       WHERE projection_version = $1 AND tenant_id = $2 AND location_id = $3 AND order_id = $4`,
      [this.projectionVersion, location.tenantId, location.locationId, orderId],
    );
    return result.rows[0] ? mapSale(result.rows[0]) : null;
  }
}

function buildFilters(values: unknown[], entries: Array<[string, unknown]>): string[] {
  const filters: string[] = [];
  for (const [column, value] of entries) {
    if (value === undefined) continue;
    values.push(value);
    filters.push(`${column} $${values.length}`);
  }
  return filters;
}

function page<T>(rows: T[], limit: number): CloudReadPage<T> {
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

function exactNumber(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Projected money exceeds safe integer range.');
  return result;
}

function mapLocation(row: ReadRow): LocationOperationalRecord {
  return {
    tenantId: row.tenant_id,
    locationId: row.location_id,
    edgeId: row.edge_id,
    heartbeatStatus: row.heartbeat_status,
    lastSeenAt: row.last_seen_at,
    reportedAt: row.reported_at,
    edgeVersion: row.edge_version,
    schemaVersion: row.schema_version,
    pendingEventCount: row.pending_event_count,
    activeDeadLetterCount: row.active_dead_letter_count,
    stalledEventCount: row.stalled_event_count,
    incompleteSaleCount: row.incomplete_sale_count,
    checkpointDegraded: row.checkpoint_degraded,
    lastEventReceivedAt: row.last_event_received_at,
    lastProjectionProcessedAt: row.last_projection_processed_at,
  };
}

function scope(row: ReadRow): ScopedLocation {
  return { tenantId: row.tenant_id, locationId: row.location_id, edgeId: requiredString(row.edge_id) };
}

function mapOrder(row: ReadRow): OrderReadRecord {
  return {
    ...scope(row), orderId: row.order_id, orderType: row.order_type,
    orderChannel: row.order_channel, status: row.status, tableIds: row.table_ids,
    paymentRequestedAt: row.payment_requested_at, itemCount: row.item_count,
    sentItemCount: row.sent_item_count, paidAmount: exactNumber(row.paid_amount),
    tipAmount: exactNumber(row.tip_amount), currency: row.currency, createdAt: row.created_at,
    closedAt: row.closed_at, cancelledAt: row.cancelled_at,
  };
}

function mapPayment(row: ReadRow): PaymentReadRecord {
  return {
    ...scope(row), paymentId: row.payment_id, orderId: row.order_id,
    cashSessionId: row.cash_session_id, method: row.method,
    amountApplied: exactNumber(row.amount_applied), tipAmount: exactNumber(row.tip_amount),
    currency: requiredString(row.currency), status: row.status, completedAt: row.completed_at,
    voidedAt: row.voided_at,
  };
}

function mapSale(row: ReadRow): SaleReadRecord {
  return {
    ...scope(row), orderId: row.order_id, saleAmount: exactNumber(row.sale_amount),
    tipAmount: exactNumber(row.tip_amount), chargedTotal: exactNumber(row.charged_total),
    currency: row.currency, completenessStatus: row.completeness_status,
    closedAt: requiredDate(row.closed_at),
  };
}

function mapCashSession(row: ReadRow): CashSessionReadRecord {
  return {
    ...scope(row), cashSessionId: row.cash_session_id, cashRegisterId: row.cash_register_id,
    businessDate: row.business_date, currency: requiredString(row.currency), status: row.status,
    openingFloatAmount: exactNumber(row.opening_float_amount),
    cashInAmount: exactNumber(row.cash_in_amount), cashOutAmount: exactNumber(row.cash_out_amount),
    expectedCashAmount: row.expected_cash_amount === null ? null : exactNumber(row.expected_cash_amount),
    countedCashAmount: row.counted_cash_amount === null ? null : exactNumber(row.counted_cash_amount),
    differenceAmount: row.difference_amount === null ? null : exactNumber(row.difference_amount),
    openedAt: row.opened_at, closedAt: row.closed_at, closedBy: row.closed_by,
  };
}

function mapCashMovement(row: ReadRow): CashMovementReadRecord {
  return {
    ...scope(row), cashMovementId: row.cash_movement_id, cashSessionId: row.cash_session_id,
    movementType: row.movement_type, amount: exactNumber(row.amount),
    currency: requiredString(row.currency),
    reason: row.reason, actorUserId: row.actor_user_id, occurredAt: row.occurred_at,
  };
}

function requiredString(value: string | null): string {
  if (!value) throw new Error('Required projected string is missing.');
  return value;
}

function requiredDate(value: Date | null): Date {
  if (!value) throw new Error('Required projected timestamp is missing.');
  return value;
}
