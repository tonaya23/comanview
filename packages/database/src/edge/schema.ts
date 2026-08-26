import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── INFRASTRUCTURE ─────────────────────────────────────────────────────────

export const eventLog = sqliteTable('event_log', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  version: integer('version'),
  payload: text('payload').notNull(), // JSON
  occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  commandId: text('command_id'),
  syncStatus: text('sync_status').notNull().default('PENDING'), // PENDING | SYNCED
});

export const processedCommands = sqliteTable('processed_commands', {
  commandId: text('command_id').primaryKey(),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }).notNull(),
});

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
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const orderTableAssignments = sqliteTable(
  'order_table_assignments',
  {
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    tableId: text('table_id').notNull(),
  },
  (table) => ({
    unq: uniqueIndex('unq_order_table_assignment').on(table.orderId, table.tableId),
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
  roundId: text('round_id').references(() => rounds.id),
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

// ─── CASH ───────────────────────────────────────────────────────────────────

export const cashRegisters = sqliteTable('cash_registers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
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
  openCommandId: text('open_command_id').notNull().unique(),
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
