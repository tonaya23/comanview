import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAdministrationSchemaMigration, inspectAdministrationSchema } from '../administrationUpgradeSchema.js';

const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
const migration = readFileSync(join(directory, '0015_restaurant_administration.sql'), 'utf8');
function legacy() {
  const db = new Database(':memory:');
  for (const file of readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 14).sort())
    db.exec(readFileSync(join(directory, file), 'utf8'));
  db.pragma('foreign_keys=ON');
  db.exec(`
    INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES('tax','Original',1600,'TAX_ADDED');
    INSERT INTO products(id,name,tax_profile_id,base_price_amount,base_price_currency) VALUES('product','Meal','tax',10000,'MXN');
    INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES('owner','tenant','location','Owner','ACTIVE','existing-salted-hash',1);
    INSERT INTO user_roles(user_id,role_id) SELECT 'owner',id FROM roles WHERE name='OWNER';
    INSERT INTO restaurant_tables(id,tenant_id,location_id,name,zone) VALUES('table','tenant','location','Table','Patio');
    INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at)
      VALUES('order','tenant','location','COUNTER','POS','1','MXN','OPEN',1,1);
    INSERT INTO order_items(id,order_id,product_id,product_name,base_price_amount,base_price_currency,tax_rate_basis_points,tax_calculation_mode,quantity,send_status,prep_status)
      VALUES('item','order','product','Meal',10000,'MXN',1600,'TAX_ADDED',1,'DRAFT','PENDING');
    INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,active,blind_cash_count,created_at)
      VALUES('cash','tenant','location','Register','MXN',1,1,1);
    INSERT INTO cash_sessions(id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,opened_at,opened_by,open_command_id)
      VALUES('session','cash','tenant','location',1000,'MXN','2026-09-02','OPEN',1,'owner','cash-open');
    INSERT INTO event_log(id,event_type,aggregate_id,payload,occurred_at) VALUES('event','ORDER_CREATED','order','{}',1);
  `);
  return db;
}

describe('0015 incremental administration schema', () => {
  it('applies the canonical SQL once and recognizes the completed schema idempotently', () => {
    const db = legacy();
    try {
      expect(inspectAdministrationSchema(db)).toBe(14);
      applyAdministrationSchemaMigration(db);
      expect(inspectAdministrationSchema(db)).toBe(15);
      applyAdministrationSchemaMigration(db);
      expect(db.prepare('SELECT count(*) n FROM tax_profile_revisions').get()).toEqual({ n: 1 });
    } finally { db.close(); }
  });
  it('rejects unsupported/custom schemas and future versions before mutation', () => {
    const db = legacy();
    try {
      db.pragma('user_version=16');
      expect(() => applyAdministrationSchemaMigration(db)).toThrow();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='business_profiles'").get()).toBeUndefined();
      db.pragma('user_version=14');
      db.exec('CREATE TABLE unexpected_custom_table(id TEXT)');
      expect(() => applyAdministrationSchemaMigration(db)).toThrow();
    } finally { db.close(); }
  });
  it('preserves every preexisting column and row while leaving legacy trust uninitialized', () => {
    const db = legacy();
    try {
      const tables = ['users','user_roles','products','tax_profiles','restaurant_tables','orders','order_items','cash_registers','cash_sessions','event_log'];
      const before = tables.map(table => {
        const columns = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(c => `"${c.name}"`).join(',');
        const query = `SELECT ${columns} FROM ${table} ORDER BY rowid`;
        return { query, rows: db.prepare(query).all() };
      });
      db.exec(migration);
      for (const snapshot of before) expect(db.prepare(snapshot.query).all()).toEqual(snapshot.rows);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('user_version', { simple: true })).toBe(15);
      expect(db.prepare('SELECT trust_domain_id,credential_revision,authorization_revision FROM users').get())
        .toEqual({ trust_domain_id: null, credential_revision: null, authorization_revision: null });
      expect(db.prepare('SELECT tax_policy_version FROM order_items').get()).toEqual({ tax_policy_version: 0 });
      expect(db.prepare('SELECT count(*) n FROM operational_configuration').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
  it('makes tax revisions immutable without inventing historical timestamps', () => {
    const db = legacy();
    try {
      db.exec(migration);
      expect(db.prepare('SELECT * FROM tax_profile_revisions').get()).toEqual({
        tax_profile_id: 'tax', revision: 1, rate_basis_points: 1600, calculation_mode: 'TAX_ADDED', created_at: null,
      });
      expect(() => db.exec('UPDATE tax_profile_revisions SET rate_basis_points=0')).toThrow('TAX_REVISION_IMMUTABLE');
      expect(() => db.exec('DELETE FROM tax_profile_revisions')).toThrow('TAX_REVISION_IMMUTABLE');
    } finally { db.close(); }
  });
  it('does not permit clearing a financial currency lock or relabeling it', () => {
    const db = legacy();
    try {
      db.exec(migration);
      db.exec("INSERT INTO operational_configuration(location_id,tenant_id,currency,currency_locked,updated_at) VALUES('location','tenant','MXN',1,1)");
      expect(() => db.exec('UPDATE operational_configuration SET currency_locked=0')).toThrow('CURRENCY_LOCKED');
      expect(() => db.exec("UPDATE operational_configuration SET currency='USD'")).toThrow('CURRENCY_LOCKED');
    } finally { db.close(); }
  });
});
