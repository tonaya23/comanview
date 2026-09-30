import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { applyModifierQuantitySchemaMigration, inspectModifierQuantitySchema } from '../modifierQuantityUpgradeSchema.js';

function fixture() {
  const db = new Database(':memory:');
  const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
  for (const file of readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 16).sort())
    db.exec(readFileSync(join(directory, file), 'utf8'));
  return db;
}
it('migrates real schema16 to17 idempotently without changing existing table data', () => {
  const db = fixture();
  try {
    const grants = db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_code').all();
    applyModifierQuantitySchemaMigration(db);
    expect(inspectModifierQuantitySchema(db)).toBe(17);
    applyModifierQuantitySchemaMigration(db);
    expect(db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_code').all()).toEqual(grants);
    expect(db.prepare("SELECT dflt_value FROM pragma_table_info('order_item_modifiers') WHERE name='quantity'").get()).toEqual({ dflt_value: '1' });
  } finally { db.close(); }
});
it('rejects a version marker without quantity and rejects altered default/constraint', () => {
  const db = fixture();
  try {
    db.pragma('user_version=17');
    expect(() => inspectModifierQuantitySchema(db)).toThrow('MODIFIER_SCHEMA_INVALID');
    db.exec('ALTER TABLE order_item_modifiers ADD COLUMN quantity INTEGER NOT NULL DEFAULT 2');
    expect(() => inspectModifierQuantitySchema(db)).toThrow('MODIFIER_SCHEMA_INVALID');
  } finally { db.close(); }
});
it('rolls back the schema transition with its caller transaction', () => {
  const db = fixture();
  try {
    db.exec('BEGIN IMMEDIATE');
    applyModifierQuantitySchemaMigration(db);
    db.exec('ROLLBACK');
    expect(inspectModifierQuantitySchema(db)).toBe(16);
    expect(db.prepare("SELECT 1 FROM pragma_table_info('order_item_modifiers') WHERE name='quantity'").get()).toBeUndefined();
  } finally { db.close(); }
});
