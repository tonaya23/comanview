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

export const cloudTenants = pgTable('cloud_tenants', {
  tenantId: uuid('tenant_id').primaryKey(),
  displayName: text('display_name'),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cloudLocations = pgTable(
  'cloud_locations',
  {
    locationId: uuid('location_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    displayName: text('display_name'),
    timezone: text('timezone'),
    status: text('status').notNull().default('ACTIVE'),
    configurationStatus: text('configuration_status').notNull().default('COMPLETE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ tenantLocation: uniqueIndex('unq_cloud_location_tenant').on(table.tenantId, table.locationId) }),
);

export const cloudEdges = pgTable(
  'edges',
  {
    edgeId: uuid('edge_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    credentialHash: text('credential_hash'),
    status: text('status').notNull().default('ACTIVE'),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
    replacedByEdgeId: uuid('replaced_by_edge_id'),
    provisioningAttemptId: uuid('provisioning_attempt_id'),
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

export const cloudAdminUsers = pgTable(
  'cloud_admin_users',
  {
    userId: uuid('user_id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    credentialHash: text('credential_hash').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    normalizedEmail: uniqueIndex('unq_cloud_admin_users_email_normalized').on(
      sql`lower(${table.email})`,
    ),
  }),
);

export const cloudAdminSessions = pgTable(
  'cloud_admin_sessions',
  {
    sessionId: uuid('session_id').primaryKey(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({ tokenHash: uniqueIndex('unq_cloud_admin_sessions_token_hash').on(table.tokenHash) }),
);

export const cloudAdminTenantGrants = pgTable(
  'cloud_admin_tenant_grants',
  {
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.userId, table.tenantId] }) }),
);

export const edgeCredentials = pgTable(
  'edge_credentials',
  {
    credentialId: uuid('credential_id').primaryKey(),
    edgeId: uuid('edge_id').notNull(),
    credentialHash: text('credential_hash').notNull(),
    status: text('status').notNull(),
    rotationId: uuid('rotation_id'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retireAfter: timestamp('retire_after', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    credentialHash: uniqueIndex('unq_edge_credential_hash').on(table.credentialHash),
  }),
);

export const edgeProvisioningCodes = pgTable('edge_provisioning_codes', {
  provisioningCodeId: uuid('provisioning_code_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  locationId: uuid('location_id').notNull(),
  codeHash: text('code_hash').notNull(),
  status: text('status').notNull().default('ISSUED'),
  createdByAdminUserId: uuid('created_by_admin_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedByEdgeId: uuid('consumed_by_edge_id'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByAdminUserId: uuid('revoked_by_admin_user_id'),
});

export const edgeProvisioningAttempts = pgTable('edge_provisioning_attempts', {
  attemptId: uuid('attempt_id').primaryKey(),
  provisioningCodeId: uuid('provisioning_code_id').notNull(),
  edgeId: uuid('edge_id').notNull(),
  credentialId: uuid('credential_id').notNull(),
  credentialHash: text('credential_hash').notNull(),
  status: text('status').notNull().default('EXCHANGED'),
  exchangedAt: timestamp('exchanged_at', { withTimezone: true }).notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
});

export const edgeReplacements = pgTable('edge_replacements', {
  replacementId: uuid('replacement_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  locationId: uuid('location_id').notNull(),
  oldEdgeId: uuid('old_edge_id').notNull(),
  newEdgeId: uuid('new_edge_id'),
  provisioningCodeId: uuid('provisioning_code_id').notNull(),
  status: text('status').notNull().default('PENDING'),
  reason: text('reason').notNull(),
  initiatedByAdminUserId: uuid('initiated_by_admin_user_id').notNull(),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
});

export const cloudAdminAuditLog = pgTable('cloud_admin_audit_log', {
  auditId: uuid('audit_id').primaryKey(),
  scopeKey: text('scope_key').notNull(),
  actorAdminUserId: uuid('actor_admin_user_id'),
  sessionId: uuid('session_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  tenantId: uuid('tenant_id'),
  locationId: uuid('location_id'),
  edgeId: uuid('edge_id'),
  commandId: uuid('command_id').notNull(),
  reason: text('reason'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  previousHash: text('previous_hash'),
  entryHash: text('entry_hash').notNull(),
});

export const cloudPlans = pgTable('cloud_plans', {
  planId: uuid('plan_id').primaryKey(),
  code: text('code').notNull().unique(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const cloudPlanEntitlements = pgTable(
  'cloud_plan_entitlements',
  {
    planId: uuid('plan_id').notNull(),
    capability: text('capability').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.planId, table.capability] }) }),
);

export const cloudLocationLicenseState = pgTable('cloud_location_license_state', {
  locationId: uuid('location_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  planId: uuid('plan_id').notNull(),
  declaredState: text('declared_state').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedByAdminUserId: uuid('updated_by_admin_user_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const cloudLocationConfigurationState = pgTable('cloud_location_configuration_state', {
  locationId: uuid('location_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  revision: integer('revision').notNull().default(1),
  configuration: jsonb('configuration').notNull(),
  updatedByAdminUserId: uuid('updated_by_admin_user_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const cloudLocationFeatureFlagState = pgTable('cloud_location_feature_flag_state', {
  locationId: uuid('location_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  revision: integer('revision').notNull().default(1),
  flags: jsonb('flags').notNull(),
  updatedByAdminUserId: uuid('updated_by_admin_user_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const cloudLocationControlState = pgTable('cloud_location_control_state', {
  locationId: uuid('location_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  desiredControlRevision: bigint('desired_control_revision', { mode: 'number' }).notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const cloudSignedControlDocuments = pgTable(
  'cloud_signed_control_documents',
  {
    documentId: uuid('document_id').primaryKey(),
    documentType: text('document_type').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    edgeId: uuid('edge_id').notNull(),
    revision: integer('revision').notNull(),
    kid: text('kid').notNull(),
    documentHash: text('document_hash').notNull(),
    envelope: jsonb('envelope').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    graceUntil: timestamp('grace_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    edgeStreamRevision: uniqueIndex('unq_cloud_control_edge_stream_revision').on(
      table.edgeId, table.documentType, table.revision,
    ),
  }),
);

export const cloudEdgeControlStateAcks = pgTable(
  'cloud_edge_control_state_acks',
  {
    edgeId: uuid('edge_id').notNull(),
    documentType: text('document_type').notNull(),
    revision: integer('revision').notNull(),
    documentHash: text('document_hash').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    commandId: uuid('command_id').notNull().unique(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.edgeId, table.documentType, table.revision] }) }),
);
