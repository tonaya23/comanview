import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EntityId, Order, ProductSnapshot } from '@comanview/domain';
import { Money } from '@comanview/money';
import * as schema from '../schema.js';
import { OrderRepository } from '../repositories/OrderRepository.js';
import { CatalogRepository } from '../repositories/CatalogRepository.js';

const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
function fixture(version: 14 | 15) {
  const db = new Database(':memory:');
  for (const name of readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= version).sort())
    db.exec(readFileSync(join(directory, name), 'utf8'));
  return { db, repo: new OrderRepository(drizzle(db, { schema })) };
}
function order(policy: 0 | 1) {
  const o = Order.create({ tenantId: EntityId.generate(), locationId: EntityId.generate(), currency: 'MXN',
    orderType: 'COUNTER', orderChannel: 'POS', orderNumber: 'TX-1' });
  o.addItem(new ProductSnapshot({ productId: EntityId.generate(), productName: 'Item', basePrice: Money.fromMinorUnits(10000, 'MXN'),
    taxRateBasisPoints: 1600, taxCalculationMode: 'TAX_ADDED', taxPolicyVersion: policy,
    taxProfileId: policy === 1 ? EntityId.generate() : null, taxProfileRevision: policy === 1 ? 1 : null,
    stationId: null, modifiers: [] }));
  return o;
}
function currentSnapshot(o: Order, mode: 'TAX_ADDED' | 'TAX_INCLUDED' = 'TAX_ADDED') {
  const old = o.items[0]!.snapshot;
  return new ProductSnapshot({ productId: old.productId, productName: 'Updated', basePrice: old.basePrice,
    taxRateBasisPoints: 800, taxCalculationMode: mode, taxPolicyVersion: 1,
    taxProfileId: EntityId.generate(), taxProfileRevision: 2, stationId: null, modifiers: [] });
}

// Deliberately inconsistent rehydration: persistence must not treat a changed object
// as proof of an explicit DRAFT command, nor bypass persisted SENT/CLOSED state.
function rehydrateWith(o: Order, snapshot: ProductSnapshot): Order {
  return Order.rehydrate({ id: o.id, tenantId: o.tenantId, locationId: o.locationId,
    orderType: o.orderType, orderChannel: o.orderChannel, orderNumber: o.orderNumber,
    currency: o.currency, status: 'OPEN', version: o.version, tableIds: [],
    items: o.items.map(item => ({ id: item.id, snapshot, quantity: item.quantity,
      sendStatus: 'DRAFT', prepStatus: 'PENDING', roundId: null, specialInstructions: null })),
    rounds: [], payments: [], events: [], createdAt: o.createdAt });
}
describe('fiscal snapshot persistence', () => {
  it('captures the current immutable TaxProfile revision without mutating existing Products or Items', () => {
    const { db, repo } = fixture(15);
    try {
      const o = order(1), productId = EntityId.generate(), taxId = EntityId.generate();
      db.prepare('INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES(?,?,1600,?)')
        .run(taxId.toString(), 'Tax', 'TAX_ADDED');
      db.prepare('INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode) VALUES(?,1,1600,?)')
        .run(taxId.toString(), 'TAX_ADDED');
      db.prepare('INSERT INTO products(id,name,tax_profile_id,base_price_amount,base_price_currency) VALUES(?,?,?,10000,?)')
        .run(productId.toString(), 'Meal', taxId.toString(), 'MXN');
      db.prepare('INSERT INTO operational_configuration(location_id,tenant_id,fiscal_policy_version,updated_at) VALUES(?,?,1,1)')
        .run(o.locationId.toString(), o.tenantId.toString());
      const catalog = new CatalogRepository(drizzle(db, { schema }));
      const policy = catalog.getFiscalPolicyVersion(o.tenantId.toString(), o.locationId.toString());
      const item = o.addItem(catalog.getProductById(productId)!.createSnapshot(new Map(), policy));
      repo.saveOrder(o, false);
      const originalProduct = db.prepare('SELECT * FROM products WHERE id=?').get(productId.toString());
      db.transaction(() => {
        db.prepare('INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode) VALUES(?,2,800,?)')
          .run(taxId.toString(), 'TAX_ADDED');
        db.prepare('UPDATE tax_profiles SET version=2,rate_basis_points=800 WHERE id=?').run(taxId.toString());
      })();
      expect(db.prepare('SELECT * FROM products WHERE id=?').get(productId.toString())).toEqual(originalProduct);
      const loaded = repo.getOrderById(o.id)!;
      expect(loaded.items.find(i => i.id.equals(item.id))!.snapshot.taxRateBasisPoints).toBe(1600);
      const current = catalog.getProductById(productId)!.createSnapshot(new Map(), policy);
      expect(current.taxRateBasisPoints).toBe(800);
      loaded.updateDraftItemConfiguration(item.id, current, null);
      repo.saveOrder(loaded, false);
      const persisted = repo.getOrderById(o.id)!.items.find(i => i.id.equals(item.id))!;
      expect(persisted.snapshot.taxRateBasisPoints).toBe(800);
      expect(persisted.snapshot.taxProfileRevision).toBe(2);
      expect(persisted.getLineTax().amount).toBe(800);
      db.prepare('UPDATE tax_profiles SET rate_basis_points=900 WHERE id=?').run(taxId.toString());
      expect(() => catalog.getProductById(productId)).toThrow('TAX_REVISION_INCONSISTENT');
      expect(repo.getOrderById(o.id)!.items.find(i => i.id.equals(item.id))!.getLineTax().amount).toBe(800);
    } finally { db.close(); }
  });
  it('keeps the stored 16% until explicit DRAFT edit, then persists all fiscal fields at 8%', () => {
    const { db, repo } = fixture(15);
    try {
      const original = order(1); repo.saveOrder(original, false);
      const current = currentSnapshot(original);
      const untouched = repo.getOrderById(original.id)!;
      untouched.updateItemSpecialInstructions(untouched.items[0]!.id, 'note only');
      repo.saveOrder(untouched, false);
      expect(repo.getOrderById(original.id)!.getTaxTotal().amount).toBe(1600);
      expect(() => repo.saveOrder(rehydrateWith(untouched, current), false)).toThrow('TAX_SNAPSHOT_IMMUTABLE');
      const edited = repo.getOrderById(original.id)!;
      edited.updateDraftItemConfiguration(edited.items[0]!.id, current, null);
      repo.saveOrder(edited, false);
      const result = repo.getOrderById(original.id)!;
      expect(result.items[0]!.snapshot.taxProfileId!.equals(current.taxProfileId!)).toBe(true);
      expect(result.items[0]!.snapshot.taxProfileRevision).toBe(2);
      expect(result.items[0]!.snapshot.taxRateBasisPoints).toBe(800);
      expect(result.getTaxTotal().amount).toBe(800);
      repo.saveOrder(result, false);
      expect(repo.getOrderById(original.id)!.getTotal().amount).toBe(10800);
    } finally { db.close(); }
  });
  it('persists legacy unchanged; explicit DRAFT edit alone may capture policy 1 and INCLUDED mode', () => {
    const { db, repo } = fixture(15);
    try {
      const original = order(0); repo.saveOrder(original, false);
      const loaded = repo.getOrderById(original.id)!;
      repo.saveOrder(loaded, false);
      expect(loaded.items[0]!.snapshot.taxPolicyVersion).toBe(0);
      expect(loaded.getTaxTotal().amount).toBe(0);
      loaded.updateDraftItemConfiguration(loaded.items[0]!.id, currentSnapshot(loaded, 'TAX_INCLUDED'), null);
      repo.saveOrder(loaded, false);
      const result = repo.getOrderById(original.id)!;
      expect(result.items[0]!.snapshot.taxPolicyVersion).toBe(1);
      expect(result.items[0]!.snapshot.taxCalculationMode).toBe('TAX_INCLUDED');
      expect([result.getSubtotal().amount, result.getTaxTotal().amount, result.getTotal().amount]).toEqual([9259, 741, 10000]);
    } finally { db.close(); }
  });
  it.each(['SENT', 'CLOSED'] as const)('rejects a forged DRAFT replacement over persisted %s history atomically', state => {
    const { db, repo } = fixture(15);
    try {
      const original = order(1); original.sendDraftItems(); repo.saveOrder(original, false);
      // Closed fixture avoids unrelated CashSession FK setup; this test targets the
      // repository guard against a stale/incorrect aggregate, not Order.close().
      if (state === 'CLOSED') db.prepare("UPDATE orders SET status='CLOSED' WHERE id=?").run(original.id.toString());
      const before = db.prepare('SELECT * FROM order_items').all();
      const fake = rehydrateWith(original, original.items[0]!.snapshot);
      fake.updateDraftItemConfiguration(fake.items[0]!.id, currentSnapshot(fake), null);
      expect(() => repo.saveOrder(fake, false)).toThrow('TAX_SNAPSHOT_IMMUTABLE');
      expect(db.prepare('SELECT * FROM order_items').all()).toEqual(before);
      expect(repo.getOrderById(original.id)!.getTaxTotal().amount).toBe(1600);
      expect(repo.getOrderById(original.id)!.status).toBe(state === 'CLOSED' ? 'CLOSED' : 'OPEN');
    } finally { db.close(); }
  });
  it('retains exact policy, profile revision, base, tax and total over SQLite roundtrip', () => {
    const { db, repo } = fixture(15);
    try {
      const original = order(1); repo.saveOrder(original, false);
      const restored = repo.getOrderById(original.id)!;
      expect([restored.getSubtotal().amount, restored.getTaxTotal().amount, restored.getTotal().amount]).toEqual([10000, 1600, 11600]);
      expect(restored.items[0]!.snapshot.taxProfileId!.toString()).toBe(original.items[0]!.snapshot.taxProfileId!.toString());
      expect(restored.items[0]!.snapshot.taxProfileRevision).toBe(1);
      repo.saveOrder(restored, false);
      expect(repo.getOrderById(original.id)!.getTotal().amount).toBe(11600);
    } finally { db.close(); }
  });
  it('reads historical schema 1V without adding taxes', () => {
    const { db, repo } = fixture(14);
    try {
      const original = order(0); repo.saveOrder(original, false);
      const restored = repo.getOrderById(original.id)!;
      expect(restored.getTotal().amount).toBe(10000);
      expect(restored.getTaxTotal().amount).toBe(0);
    } finally { db.close(); }
  });
  it('cannot silently lose activated fiscal metadata on an old schema', () => {
    const { db, repo } = fixture(14);
    try {
      expect(() => repo.saveOrder(order(1), false)).toThrow('TAX_SCHEMA_REQUIRED');
      expect(db.prepare('SELECT count(*) n FROM orders').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
});
