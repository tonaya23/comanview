import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
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
  },
  (table) => ({
    edgeOrder: index('idx_cloud_sync_inbox_edge_order').on(
      table.edgeId,
      table.occurredAt,
      table.localSequence,
    ),
  }),
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
