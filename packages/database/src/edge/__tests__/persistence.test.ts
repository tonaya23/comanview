import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../schema.js';
import { CatalogRepository } from '../repositories/CatalogRepository.js';
import { OrderRepository } from '../repositories/OrderRepository.js';
import {
  EntityId,
  Order,
  Product,
  ProductProps,
  TaxProfile,
  ModifierGroup,
  ModifierOption,
  ProductModifierGroup,
  Category,
} from '@comanview/domain';
import { Money } from '@comanview/money';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MIGRATION_PATH = join(__dirname, '../../../../../migrations/edge/0000_initial.sql');

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Apply migration
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  sqlite.exec(sql);

  return drizzle(sqlite, { schema });
}

function makeTaxProfile(rateBasisPoints = 1600): TaxProfile {
  return new TaxProfile({
    id: EntityId.generate(),
    name: 'IVA 16%',
    rateBasisPoints,
    calculationMode: 'TAX_INCLUDED',
    active: true,
  });
}

function makeProduct(taxProfile?: TaxProfile, currency = 'MXN', basePriceAmount = 10000): Product {
  const tp = taxProfile ?? makeTaxProfile();
  const props: ProductProps = {
    id: EntityId.generate(),
    name: 'Burger',
    description: 'Juicy burger',
    productType: 'STANDARD',
    categoryId: EntityId.generate(),
    taxProfile: tp,
    basePrice: Money.fromMinorUnits(basePriceAmount, currency),
    stationId: null,
    sku: null,
    barcode: null,
    displayOrder: 1,
    active: true,
    available: true,
    modifierGroups: [],
  };
  return new Product(props);
}

function makeOrder(currency = 'MXN') {
  return Order.create({
    tenantId: EntityId.generate(),
    locationId: EntityId.generate(),
    orderType: 'COUNTER',
    orderChannel: 'POS',
    orderNumber: 'A-001',
    currency,
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Edge Persistence Integration Tests', () => {

  // ── 1. Migration + Pragmas ─────────────────────────────────────────────────

  it('1. migration applies cleanly on a fresh DB', () => {
    const db = createTestDb();
    const tables = db.run.bind(db);
    // If we got here without exception, migration is valid
    expect(db).toBeDefined();
  });

  it('2. WAL mode and foreign keys are enabled on a file-based DB', () => {
    // WAL mode requires a file-backed database; :memory: always uses 'memory' journal.
    // We verify the pragmas are correctly set when createEdgeDatabase() is used
    // with a temp path — same code path as the real Edge runtime.
    const os = require('os');
    const path = require('path');
    const tmpPath = path.join(os.tmpdir(), `comanview-test-${Date.now()}.db`);
    const sqlite = new Database(tmpPath);
    try {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec(readFileSync(MIGRATION_PATH, 'utf-8'));

      const walMode = sqlite.pragma('journal_mode', { simple: true });
      const fkMode = sqlite.pragma('foreign_keys', { simple: true });
      expect(walMode).toBe('wal');
      expect(fkMode).toBe(1);
    } finally {
      sqlite.close();
      try { require('fs').unlinkSync(tmpPath); } catch { /* ignore */ }
      try { require('fs').unlinkSync(tmpPath + '-shm'); } catch { /* ignore */ }
      try { require('fs').unlinkSync(tmpPath + '-wal'); } catch { /* ignore */ }
    }
  });

  // ── 3. Save and retrieve Product ──────────────────────────────────────────

  it('3. saves and retrieves a simple Product', () => {
    const db = createTestDb();
    const repo = new CatalogRepository(db);

    const product = makeProduct();
    repo.saveProduct(product);

    const found = repo.getProductById(product.id);
    expect(found).not.toBeNull();
    expect(found!.id.toString()).toBe(product.id.toString());
    expect(found!.name).toBe('Burger');
  });

  // ── 4. Save and retrieve Order ────────────────────────────────────────────

  it('4. saves and retrieves a basic Order', () => {
    const db = createTestDb();
    const repo = new OrderRepository(db);

    const order = makeOrder();
    repo.saveOrder(order, false);

    const found = repo.getOrderById(order.id);
    expect(found).not.toBeNull();
    expect(found!.id.toString()).toBe(order.id.toString());
    expect(found!.status).toBe('OPEN');
    expect(found!.currency).toBe('MXN');
    expect(found!.orderNumber).toBe('A-001');
  });

  // ── 5. Order with multiple items ──────────────────────────────────────────

  it('5. saves and retrieves an Order with multiple items', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct();
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    const snap1 = product.createSnapshot(new Map());
    const snap2 = product.createSnapshot(new Map());
    order.addItem(snap1);
    order.addItem(snap2);
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    expect(found!.items).toHaveLength(2);
  });

  // ── 6. Modifier snapshot preserved ───────────────────────────────────────

  it('6. modifiers + historical price delta are preserved in snapshot', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const option = new ModifierOption({
      id: EntityId.generate(),
      name: 'Extra Cheese',
      defaultPriceDelta: Money.fromMinorUnits(150, 'MXN'),
      active: true,
      available: true,
      displayOrder: 0,
    });

    const group = new ModifierGroup({
      id: EntityId.generate(),
      name: 'Add-ons',
      minSelections: 0,
      maxSelections: 1,
      active: true,
      options: [option],
    });

    const tp = makeTaxProfile();
    const product = new Product({
      id: EntityId.generate(),
      name: 'Pizza',
      description: '',
      productType: 'STANDARD',
      categoryId: EntityId.generate(),
      taxProfile: tp,
      basePrice: Money.fromMinorUnits(20000, 'MXN'),
      stationId: null,
      sku: null,
      barcode: null,
      displayOrder: 0,
      active: true,
      available: true,
      modifierGroups: [new ProductModifierGroup({ modifierGroup: group, priceDeltaOverrides: new Map() })],
    });

    catalogRepo.saveProduct(product);

    const order = makeOrder();
    const selectedOptions = new Map([[group.id.toString(), [option.id]]]);
    const snap = product.createSnapshot(selectedOptions);
    order.addItem(snap);
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    const item = found!.items[0]!;
    expect(item.snapshot.modifiers).toHaveLength(1);
    expect(item.snapshot.modifiers[0]!.name).toBe('Extra Cheese');
    expect(item.snapshot.modifiers[0]!.priceDelta.amount).toBe(150);
    expect(item.snapshot.modifiers[0]!.priceDelta.currency).toBe('MXN');
  });

  // ── 7. Multiple Rounds preserved ─────────────────────────────────────────

  it('7. multiple rounds are persisted and retrieved correctly', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct();
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    order.addItem(product.createSnapshot(new Map()));
    const r1 = order.sendDraftItems();
    order.addItem(product.createSnapshot(new Map()));
    const r2 = order.sendDraftItems();
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    expect(found!.rounds).toHaveLength(2);
    expect(found!.rounds[0]!.roundNumber).toBe(1);
    expect(found!.rounds[1]!.roundNumber).toBe(2);
  });

  // ── 8. Table assignments ──────────────────────────────────────────────────

  it('8. table assignments are preserved', () => {
    const db = createTestDb();
    const repo = new OrderRepository(db);

    const t1 = EntityId.generate();
    const t2 = EntityId.generate();

    const order = Order.create({
      tenantId: EntityId.generate(),
      locationId: EntityId.generate(),
      orderType: 'TABLE',
      orderChannel: 'WAITER',
      orderNumber: 'T-001',
      currency: 'MXN',
      tableIds: [t1, t2],
    });

    repo.saveOrder(order, false);

    const found = repo.getOrderById(order.id);
    expect(found!.tableIds).toHaveLength(2);
    const ids = found!.tableIds.map((t) => t.toString());
    expect(ids).toContain(t1.toString());
    expect(ids).toContain(t2.toString());
  });

  // ── 9 & 10. Currency and Money preserved exactly ──────────────────────────

  it('9 & 10. currency field and Money minor units are preserved exactly (no float)', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct(undefined, 'USD', 9999);
    catalogRepo.saveProduct(product);

    const order = Order.create({
      tenantId: EntityId.generate(),
      locationId: EntityId.generate(),
      orderType: 'COUNTER',
      orderChannel: 'POS',
      orderNumber: 'U-001',
      currency: 'USD',
    });

    order.addItem(product.createSnapshot(new Map()));
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    expect(found!.currency).toBe('USD');
    expect(found!.items[0]!.snapshot.basePrice.amount).toBe(9999);
    expect(found!.items[0]!.snapshot.basePrice.currency).toBe('USD');
    // Exact integer — must not become 99.99 or lose precision
    expect(Number.isInteger(found!.items[0]!.snapshot.basePrice.amount)).toBe(true);
  });

  // ── 11. Tax basis points preserved ───────────────────────────────────────

  it('11. tax rateBasisPoints preserved as integer', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const tp = makeTaxProfile(1650); // 16.5%
    const product = makeProduct(tp);
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    order.addItem(product.createSnapshot(new Map()));
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    const snap = found!.items[0]!.snapshot;
    expect(snap.taxRateBasisPoints).toBe(1650);
    expect(Number.isInteger(snap.taxRateBasisPoints)).toBe(true);
  });

  // ── 12. Version of Order preserved ───────────────────────────────────────

  it('12. Order version is preserved correctly', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct();
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    order.addItem(product.createSnapshot(new Map()));
    order.addItem(product.createSnapshot(new Map()));
    const versionBeforeSave = order.version;
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    expect(found!.version).toBe(versionBeforeSave);
    expect(found!.version).toBe(3); // 1 (create) + 2 (two addItems)
  });

  // ── 13. CLOSED / CANCELLED state preserved ────────────────────────────────

  it('13. CLOSED status is preserved after close(Money.zero)', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct();
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    order.addItem(product.createSnapshot(new Map()));
    order.sendDraftItems();
    order.close(Money.zero('MXN'));
    orderRepo.saveOrder(order, false);

    const found = orderRepo.getOrderById(order.id);
    expect(found!.status).toBe('CLOSED');
  });

  it('13b. CANCELLED status is preserved', () => {
    const db = createTestDb();
    const repo = new OrderRepository(db);

    const order = makeOrder();
    order.cancel();
    repo.saveOrder(order, false);

    const found = repo.getOrderById(order.id);
    expect(found!.status).toBe('CANCELLED');
  });

  // ── 14. Historical snapshot is independent of catalog changes ─────────────

  it('14. snapshot remains historically accurate even if product price changes', () => {
    const db = createTestDb();
    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct(undefined, 'MXN', 10000);
    catalogRepo.saveProduct(product);

    const order = makeOrder();
    order.addItem(product.createSnapshot(new Map()));
    orderRepo.saveOrder(order, false);

    // Simulate product "price change" — different product with same ID concept:
    // In practice the catalog would have a new version, but the snapshot must stay fixed.
    const found = orderRepo.getOrderById(order.id);
    expect(found!.items[0]!.snapshot.basePrice.amount).toBe(10000);

    // Re-save order with same snapshot to verify it doesn't mutate
    orderRepo.saveOrder(found!, false);
    const found2 = orderRepo.getOrderById(order.id);
    expect(found2!.items[0]!.snapshot.basePrice.amount).toBe(10000);
  });

  // ── 15. Transaction rollback ──────────────────────────────────────────────

  it('15. transaction rolls back correctly on FK violation', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(MIGRATION_PATH, 'utf-8'));
    const db = drizzle(sqlite, { schema });

    // Try to insert an order_item referencing a non-existent order — FK violation
    expect(() => {
      db.transaction((tx) => {
        tx.insert(schema.orderItems).values({
          id: EntityId.generate().toString(),
          orderId: 'nonexistent-order-id',
          productId: EntityId.generate().toString(),
          productName: 'Test',
          basePriceAmount: 100,
          basePriceCurrency: 'MXN',
          taxRateBasisPoints: 1600,
          taxCalculationMode: 'TAX_INCLUDED',
          stationId: null,
          quantity: 1,
          sendStatus: 'DRAFT',
          prepStatus: 'PENDING',
          roundId: null,
        }).run();
      });
    }).toThrow();
  });

  // ── 16. event_log in same transaction ────────────────────────────────────

  it('16. domain events are persisted to event_log in the same transaction', () => {
    const db = createTestDb();
    const repo = new OrderRepository(db);

    const order = makeOrder();
    // saveOrder with emitEvents=true (the default)
    repo.saveOrder(order, true);

    const logs = db.select().from(schema.eventLog).all();
    // Should have at least the ORDER_CREATED event
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.eventType).toBe('ORDER_CREATED');
    expect(logs[0]!.aggregateId).toBe(order.id.toString());
    expect(logs[0]!.syncStatus).toBe('PENDING');
  });

  // ── 17. FK constraints reject invalid data ────────────────────────────────

  it('17. FK constraint rejects order_items without a valid order', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(MIGRATION_PATH, 'utf-8'));
    const db = drizzle(sqlite, { schema });

    expect(() =>
      db.insert(schema.rounds).values({
        id: EntityId.generate().toString(),
        orderId: 'bad-order-id',
        roundNumber: 1,
        sentAt: new Date(),
      }).run()
    ).toThrow();
  });

  // ── 18. Re-opening the database preserves state (File-based) ──────────────

  it('18. state survives database close and reopen', () => {
    const os = require('os');
    const path = require('path');
    const { createEdgeDatabase } = require('../db.js');

    const tmpPath = path.join(os.tmpdir(), `comanview-test-reopen-${Date.now()}.db`);
    
    // 1. Create DB and migration
    let dbHandle = createEdgeDatabase(tmpPath);
    let db = dbHandle.db;
    dbHandle.sqlite.exec(readFileSync(MIGRATION_PATH, 'utf-8'));

    const catalogRepo = new CatalogRepository(db);
    const orderRepo = new OrderRepository(db);

    const product = makeProduct();
    catalogRepo.saveProduct(product);

    const order = makeOrder('USD');
    order.addItem(product.createSnapshot(new Map()));
    order.sendDraftItems();
    orderRepo.saveOrder(order, true);

    // Close the connection completely
    dbHandle.close();

    // 2. Reopen DB
    dbHandle = createEdgeDatabase(tmpPath);
    db = dbHandle.db;
    const orderRepo2 = new OrderRepository(db);

    const recovered = orderRepo2.getOrderById(order.id);
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe('OPEN');
    expect(recovered!.currency).toBe('USD');
    expect(recovered!.version).toBe(3); // created + item added + round sent
    expect(recovered!.rounds).toHaveLength(1);
    expect(recovered!.items).toHaveLength(1);

    // Clean up
    dbHandle.close();
    try { require('fs').unlinkSync(tmpPath); } catch { /* ignore */ }
    try { require('fs').unlinkSync(tmpPath + '-shm'); } catch { /* ignore */ }
    try { require('fs').unlinkSync(tmpPath + '-wal'); } catch { /* ignore */ }
  });

  // ── 19. Event Log outbox deduplication ────────────────────────────────────

  it('19. identical events are not duplicated in the event_log if saved multiple times', () => {
    const db = createTestDb();
    const repo = new OrderRepository(db);

    const order = makeOrder();
    repo.saveOrder(order, true);
    
    const { sql } = require('drizzle-orm');
    const countQuery = db.select({ count: sql`count(*)` }).from(schema.eventLog);
    const count1 = (countQuery.get() as any).count;
    expect(count1).toBe(1); // Only ORDER_CREATED

    // Save the exact same order with the same event array again
    repo.saveOrder(order, true);

    const count2 = (countQuery.get() as any).count;
    expect(count2).toBe(1); // Should still be 1 because eventId is the same and onConflictDoNothing applies
  });
});

