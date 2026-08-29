import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── INFRASTRUCTURE ─────────────────────────────────────────────────────────

export const eventLog = sqliteTable('event_log', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull().default('UNKNOWN'),
  aggregateId: text('aggregate_id').notNull(),
  version: integer('version'),
  payload: text('payload').notNull(), // JSON
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  localSequence: integer('local_sequence'),
  commandId: text('command_id'),
  syncStatus: text('sync_status').notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp_ms' }),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
});

export const edgeInstallations = sqliteTable('edge_installations', {
  singletonKey: text('singleton_key').primaryKey(),
  edgeId: text('edge_id').notNull().unique(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  provisioningState: text('provisioning_state').notNull().default('ACTIVE'),
  credentialId: text('credential_id'),
  provisioningAttemptId: text('provisioning_attempt_id'),
  provisionedAt: integer('provisioned_at', { mode: 'timestamp_ms' }),
  activatedAt: integer('activated_at', { mode: 'timestamp_ms' }),
});

export const edgeProvisioningJournal = sqliteTable('edge_provisioning_journal', {
  singletonKey: text('singleton_key').primaryKey(),
  edgeId: text('edge_id').notNull(),
  attemptId: text('attempt_id').notNull(),
  credentialId: text('credential_id').notNull(),
  state: text('state').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const syncRuntimeState = sqliteTable('sync_runtime_state', {
  singletonKey: text('singleton_key').primaryKey(),
  cloudReachable: integer('cloud_reachable', { mode: 'boolean' }),
  lastSuccessfulSyncAt: integer('last_successful_sync_at', { mode: 'timestamp_ms' }),
  lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
});

export const processedCommands = sqliteTable('processed_commands', {
  commandId: text('command_id').primaryKey(),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─── LOCAL AUTH / RBAC ─────────────────────────────────────────────────────

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const permissions = sqliteTable('permissions', {
  code: text('code').primaryKey(),
  description: text('description').notNull(),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code),
  },
  (table) => ({ unq: uniqueIndex('unq_role_permission').on(table.roleId, table.permissionCode) }),
);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  pinHash: text('pin_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (table) => ({ unq: uniqueIndex('unq_user_role').on(table.userId, table.roleId) }),
);

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  deviceType: text('device_type').notNull(),
  status: text('status').notNull(),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  deviceId: text('device_id')
    .notNull()
    .references(() => devices.id),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  loginAt: integer('login_at', { mode: 'timestamp_ms' }).notNull(),
  lastActivity: integer('last_activity', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

export const loginAttempts = sqliteTable('login_attempts', {
  deviceId: text('device_id')
    .primaryKey()
    .references(() => devices.id),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    auditId: text('audit_id').primaryKey(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    tenantId: text('tenant_id').notNull(),
    locationId: text('location_id').notNull(),
    deviceId: text('device_id').notNull(),
    sessionId: text('session_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorRole: text('actor_role'),
    authorizedByUserId: text('authorized_by_user_id'),
    authorizedByRole: text('authorized_by_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    commandId: text('command_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    amountAffected: integer('amount_affected'),
    currency: text('currency'),
    eventId: text('event_id'),
    previousHash: text('previous_hash'),
    entryHash: text('entry_hash').notNull().unique(),
  },
  (table) => ({
    commandAction: uniqueIndex('unq_audit_command_action').on(table.commandId, table.action),
  }),
);

// ─── CATALOG ────────────────────────────────────────────────────────────────

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const taxProfiles = sqliteTable('tax_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rateBasisPoints: integer('rate_basis_points').notNull(),
  calculationMode: text('calculation_mode').notNull(), // TAX_INCLUDED | TAX_ADDED
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

export const modifierGroups = sqliteTable('modifier_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  minSelections: integer('min_selections').notNull().default(0),
  maxSelections: integer('max_selections').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const modifierOptions = sqliteTable('modifier_options', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => modifierGroups.id),
  name: text('name').notNull(),
  priceDeltaAmount: integer('price_delta_amount').notNull().default(0),
  priceDeltaCurrency: text('price_delta_currency').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  productType: text('product_type').notNull().default('STANDARD'), // STANDARD | RECIPE | NON_INVENTORY
  categoryId: text('category_id').references(() => categories.id),
  taxProfileId: text('tax_profile_id')
    .notNull()
    .references(() => taxProfiles.id),
  basePriceAmount: integer('base_price_amount').notNull(),
  basePriceCurrency: text('base_price_currency').notNull(),
  stationId: text('station_id'),
  sku: text('sku'),
  barcode: text('barcode'),
  displayOrder: integer('display_order').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  available: integer('available', { mode: 'boolean' }).notNull().default(true),
});

export const productModifierGroups = sqliteTable(
  'product_modifier_groups',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    modifierGroupId: text('modifier_group_id')
      .notNull()
      .references(() => modifierGroups.id),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (table) => ({
    unq: uniqueIndex('unq_product_modifier_group').on(table.productId, table.modifierGroupId),
  }),
);

export const modifierPriceOverrides = sqliteTable(
  'modifier_price_overrides',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    modifierOptionId: text('modifier_option_id')
      .notNull()
      .references(() => modifierOptions.id),
    priceDeltaAmount: integer('price_delta_amount').notNull(),
    priceDeltaCurrency: text('price_delta_currency').notNull(),
  },
  (table) => ({
    unq: uniqueIndex('unq_modifier_price_override').on(table.productId, table.modifierOptionId),
  }),
);

export const stations = sqliteTable('stations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// ─── ORDERS ─────────────────────────────────────────────────────────────────

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  orderType: text('order_type').notNull(), // COUNTER | TABLE | TAKEOUT
  orderChannel: text('order_channel').notNull(), // POS | WAITER
  orderNumber: text('order_number').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(), // OPEN | CLOSED | CANCELLED
  paymentRequestedAt: integer('payment_requested_at', { mode: 'timestamp_ms' }),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const restaurantTables = sqliteTable('restaurant_tables', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  zone: text('zone'),
  capacity: integer('capacity'),
  displayOrder: integer('display_order').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const orderTableAssignments = sqliteTable(
  'order_table_assignments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    tableId: text('table_id').notNull(),
    assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }).notNull(),
    releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
    commandId: text('command_id'),
  },
  (table) => ({
    activeTable: uniqueIndex('unq_active_table_assignment')
      .on(table.tableId)
      .where(sql`${table.releasedAt} IS NULL`),
  }),
);

export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  roundNumber: integer('round_number').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
});

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  basePriceAmount: integer('base_price_amount').notNull(),
  basePriceCurrency: text('base_price_currency').notNull(),
  taxRateBasisPoints: integer('tax_rate_basis_points').notNull(),
  taxCalculationMode: text('tax_calculation_mode').notNull(),
  stationId: text('station_id'),
  quantity: integer('quantity').notNull().default(1),
  sendStatus: text('send_status').notNull(), // DRAFT | SENT
  prepStatus: text('prep_status').notNull(), // PENDING | PREPARING | READY
  prepStartedAt: integer('prep_started_at', { mode: 'timestamp_ms' }),
  readyAt: integer('ready_at', { mode: 'timestamp_ms' }),
  roundId: text('round_id').references(() => rounds.id),
  specialInstructions: text('special_instructions'),
});

export const orderItemModifiers = sqliteTable('order_item_modifiers', {
  id: text('id').primaryKey(),
  orderItemId: text('order_item_id')
    .notNull()
    .references(() => orderItems.id),
  modifierOptionId: text('modifier_option_id').notNull(),
  name: text('name').notNull(),
  priceDeltaAmount: integer('price_delta_amount').notNull(),
  priceDeltaCurrency: text('price_delta_currency').notNull(),
});

// ─── PRINTING ────────────────────────────────────────────────────────────────

export const printTargets = sqliteTable('print_targets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  stationId: text('station_id').references(() => stations.id),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(),
  configurationJson: text('configuration_json').notNull().default('{}'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const printJobs = sqliteTable(
  'print_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    locationId: text('location_id').notNull(),
    orderId: text('order_id').references(() => orders.id),
    cashSessionId: text('cash_session_id'),
    roundId: text('round_id').references(() => rounds.id),
    stationId: text('station_id'),
    targetId: text('target_id').references(() => printTargets.id),
    jobType: text('job_type').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    parentJobId: text('parent_job_id'),
    dedupeKey: text('dedupe_key').notNull(),
  },
  (table) => ({
    dedupe: uniqueIndex('unq_print_job_dedupe').on(table.dedupeKey),
  }),
);

// ─── CASH ───────────────────────────────────────────────────────────────────

export const cashRegisters = sqliteTable('cash_registers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  blindCashCount: integer('blind_cash_count', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const cashSessions = sqliteTable('cash_sessions', {
  id: text('id').primaryKey(),
  cashRegisterId: text('cash_register_id')
    .notNull()
    .references(() => cashRegisters.id),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  openingFloatAmount: integer('opening_float_amount').notNull(),
  currency: text('currency').notNull(),
  businessDate: text('business_date').notNull(),
  status: text('status').notNull(),
  openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  openedBy: text('opened_by').notNull(),
  closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
  closedBy: text('closed_by'),
  closeCommandId: text('close_command_id'),
  expectedCashAtCloseAmount: integer('expected_cash_at_close_amount'),
  countedCashAmount: integer('counted_cash_amount'),
  differenceAmount: integer('difference_amount'),
  openCommandId: text('open_command_id').notNull().unique(),
});

export const cashMovements = sqliteTable('cash_movements', {
  id: text('id').primaryKey(),
  cashSessionId: text('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  movementType: text('movement_type').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  reason: text('reason').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  commandId: text('command_id').notNull().unique(),
});

export const cashReports = sqliteTable('cash_reports', {
  id: text('id').primaryKey(),
  cashSessionId: text('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  reportType: text('report_type').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
  generatedBy: text('generated_by').notNull(),
  commandId: text('command_id').notNull().unique(),
});

// ─── PAYMENTS ───────────────────────────────────────────────────────────────

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  cashSessionId: text('cash_session_id')
    .notNull()
    .references(() => cashSessions.id),
  method: text('method').notNull(),
  amountAppliedAmount: integer('amount_applied_amount').notNull(),
  tipAmount: integer('tip_amount').notNull(),
  currency: text('currency').notNull(),
  cashTenderedAmount: integer('cash_tendered_amount'),
  changeGivenAmount: integer('change_given_amount').notNull(),
  status: text('status').notNull(),
  externalReference: text('external_reference'),
  commandId: text('command_id').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
});
