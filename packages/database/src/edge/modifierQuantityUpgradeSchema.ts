import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCatalogSchema } from './catalogUpgradeSchema.js';

const directory = fileURLToPath(new URL('../../../../migrations/edge/', import.meta.url));
const migration = () => readFileSync(join(directory, '0017_modifier_quantity.sql'), 'utf8');
let reference: string | undefined;
function fingerprint(db: Database.Database): string {
  return JSON.stringify(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all());
}
function referenceSchema(): string {
  if (reference !== undefined) return reference;
  const db = new Database(':memory:');
  try {
    const files = readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 17).sort();
    if (files.length !== 18) throw new Error('MODIFIER_MIGRATIONS_UNAVAILABLE');
    for (const file of files) db.exec(readFileSync(join(directory, file), 'utf8'));
    reference = fingerprint(db);
    return reference;
  } finally { db.close(); }
}
/** Strict schema identity, including the quantity default and constraints. */
export function inspectModifierQuantitySchema(db: Database.Database): 16 | 17 {
  if (db.pragma('user_version', { simple: true }) === 17) {
    if (fingerprint(db) !== referenceSchema()) throw new Error('MODIFIER_SCHEMA_INVALID');
    return 17;
  }
  if (inspectCatalogSchema(db) === 16) return 16;
  throw new Error('MODIFIER_SCHEMA_UNSUPPORTED');
}
export function modifierQuantityMigrationDigest(): string {
  return createHash('sha256').update(migration()).digest('hex');
}
export function validateModifierQuantitySchema(db: Database.Database): void {
  if (inspectModifierQuantitySchema(db) !== 17) throw new Error('MODIFIER_SCHEMA_INVALID');
  if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length)
    throw new Error('MODIFIER_DATABASE_INVALID');
}
/** Schema primitive only: productive caller must hold the protected lifecycle authorization. */
export function applyModifierQuantitySchemaMigration(db: Database.Database): void {
  if (inspectModifierQuantitySchema(db) === 17) { validateModifierQuantitySchema(db); return; }
  if (db.pragma('quick_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length)
    throw new Error('MODIFIER_DATABASE_INVALID');
  const sql = migration();
  if (!/^BEGIN;\s/.test(sql) || !/COMMIT;\s*$/.test(sql)) throw new Error('MODIFIER_MIGRATION_INVALID');
  db.transaction(() => {
    db.exec(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    validateModifierQuantitySchema(db);
  }).immediate();
}
