import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const cloudEdges = pgTable(
  'edges',
  {
    edgeId: uuid('edge_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    credentialHash: text('credential_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    location: uniqueIndex('unq_active_edge_location')
      .on(table.locationId)
      .where(sql`${table.status} = 'ACTIVE'`),
  }),
);

export const cloudSyncInbox = pgTable(
  'cloud_sync_inbox',
  {
    eventId: uuid('event_id').primaryKey(),
    schemaVersion: integer('schema_version').notNull(),
    protocolVersion: text('protocol_version').notNull(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version'),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    localSequence: integer('local_sequence').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processingStatus: text('processing_status').notNull().default('RECEIVED'),
    processingProjectionName: text('processing_projection_name'),
    processingProjectionVersion: integer('processing_projection_version'),
    processingAttemptCount: integer('processing_attempt_count').notNull().default(0),
    processingOwner: text('processing_owner'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingLeaseExpiresAt: timestamp('processing_lease_expires_at', { withTimezone: true }),
    processingNextAttemptAt: timestamp('processing_next_attempt_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingLastError: text('processing_last_error'),
  },
  (table) => ({
    edgeOrder: index('idx_cloud_sync_inbox_edge_order').on(
      table.edgeId,
      table.occurredAt,
      table.localSequence,
    ),
    edgeSequence: uniqueIndex('unq_cloud_sync_inbox_edge_sequence').on(
      table.edgeId,
      table.localSequence,
    ),
    processing: index('idx_cloud_sync_inbox_processing').on(
      table.processingLeaseExpiresAt,
      table.processingNextAttemptAt,
      table.edgeId,
      table.localSequence,
    ),
  }),
);

export const cloudProjectionEventReceipts = pgTable(
  'cloud_projection_event_receipts',
  {
    projectionName: text('projection_name').notNull(),
    projectionVersion: integer('projection_version').notNull(),
    eventId: uuid('event_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    localSequence: integer('local_sequence').notNull(),
    outcome: text('outcome').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectionName, table.projectionVersion, table.eventId] }),
  }),
);

export const cloudProjectionCheckpoints = pgTable(
  'cloud_projection_checkpoints',
  {
    projectionName: text('projection_name').notNull(),
    projectionVersion: integer('projection_version').notNull(),
    edgeId: uuid('edge_id').notNull(),
    lastLocalSequence: integer('last_local_sequence').notNull(),
    lastEventId: uuid('last_event_id').notNull(),
    degraded: boolean('degraded').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectionName, table.projectionVersion, table.edgeId] }),
  }),
);

export const cloudOrderOperationalSummaries = pgTable(
  'cloud_order_operational_summaries',
  {
    projectionVersion: integer('projection_version').notNull(),
    orderId: uuid('order_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    orderType: text('order_type').notNull(),
    orderChannel: text('order_channel').notNull(),
    status: text('status').notNull(),
    tableIds: jsonb('table_ids').notNull(),
    paymentRequestedAt: timestamp('payment_requested_at', { withTimezone: true }),
    itemCount: integer('item_count').notNull().default(0),
    sentItemCount: integer('sent_item_count').notNull().default(0),
    paidAmount: bigint('paid_amount', { mode: 'number' }).notNull().default(0),
    tipAmount: bigint('tip_amount', { mode: 'number' }).notNull().default(0),
    currency: text('currency'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastEventId: uuid('last_event_id').notNull(),
    lastLocalSequence: integer('last_local_sequence').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectionVersion, table.orderId] }) }),
);

export const cloudPaymentSummaries = pgTable(
  'cloud_payment_summaries',
  {
    projectionVersion: integer('projection_version').notNull(),
    paymentId: uuid('payment_id').notNull(),
    orderId: uuid('order_id').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    method: text('method').notNull(),
    amountApplied: bigint('amount_applied', { mode: 'number' }).notNull(),
    tipAmount: bigint('tip_amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    lastEventId: uuid('last_event_id').notNull(),
    lastLocalSequence: integer('last_local_sequence').notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectionVersion, table.paymentId] }) }),
);

export const cloudClosedSaleSummaries = pgTable(
  'cloud_closed_sale_summaries',
  {
    projectionVersion: integer('projection_version').notNull(),
    orderId: uuid('order_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    saleAmount: bigint('sale_amount', { mode: 'number' }).notNull(),
    tipAmount: bigint('tip_amount', { mode: 'number' }).notNull(),
    chargedTotal: bigint('charged_total', { mode: 'number' }).notNull(),
    currency: text('currency'),
    completenessStatus: text('completeness_status').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    lastLocalSequence: integer('last_local_sequence').notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectionVersion, table.orderId] }) }),
);

export const cloudCashSessionSummaries = pgTable(
  'cloud_cash_session_summaries',
  {
    projectionVersion: integer('projection_version').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    cashRegisterId: uuid('cash_register_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    businessDate: text('business_date').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    openingFloatAmount: bigint('opening_float_amount', { mode: 'number' }).notNull(),
    cashInAmount: bigint('cash_in_amount', { mode: 'number' }).notNull().default(0),
    cashOutAmount: bigint('cash_out_amount', { mode: 'number' }).notNull().default(0),
    expectedCashAmount: bigint('expected_cash_amount', { mode: 'number' }),
    countedCashAmount: bigint('counted_cash_amount', { mode: 'number' }),
    differenceAmount: bigint('difference_amount', { mode: 'number' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    lastEventId: uuid('last_event_id').notNull(),
    lastLocalSequence: integer('last_local_sequence').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectionVersion, table.cashSessionId] }) }),
);

export const cloudCashMovements = pgTable(
  'cloud_cash_movements',
  {
    projectionVersion: integer('projection_version').notNull(),
    cashMovementId: uuid('cash_movement_id').notNull(),
    cashSessionId: uuid('cash_session_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    movementType: text('movement_type').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    localSequence: integer('local_sequence').notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectionVersion, table.cashMovementId] }) }),
);

export const edgeHeartbeats = pgTable('edge_heartbeats', {
  edgeId: uuid('edge_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  locationId: uuid('location_id').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  edgeVersion: text('edge_version').notNull(),
  schemaVersion: text('schema_version').notNull(),
  pendingEventCount: integer('pending_event_count').notNull(),
  status: text('status').notNull(),
  reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
});
