import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRecoveryUpgradeSchema } from './recoveryUpgradeSchema.js';

const directory = fileURLToPath(new URL('../../../../migrations/edge/', import.meta.url));
const filename = '0015_restaurant_administration.sql';
const migration = () => readFileSync(join(directory, filename), 'utf8');
let reference: string | undefined;

function fingerprint(db: Database.Database): string {
  return JSON.stringify(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all());
}

function referenceSchema(): string {
  if (reference !== undefined) return reference;
  const db = new Database(':memory:');
  try {
    const files = readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 15).sort();
    if (files.length !== 16) throw new Error('ADMINISTRATION_MIGRATIONS_UNAVAILABLE');
    for (const file of files) db.exec(readFileSync(join(directory, file), 'utf8'));
    reference = fingerprint(db);
    return reference;
  } finally { db.close(); }
}

/** Schema 13 remains the responsibility of the existing 1U -> 1V lifecycle. */
export function inspectAdministrationSchema(db: Database.Database): 14 | 15 {
  const version = db.pragma('user_version', { simple: true });
  if (version === 15 && fingerprint(db) === referenceSchema()) return 15;
  if ((version === 0 || version === 14) && inspectRecoveryUpgradeSchema(db) === 14) return 14;
  throw new Error('ADMINISTRATION_SCHEMA_UNSUPPORTED');
}

export function administrationMigrationDigest(): string {
  return createHash('sha256').update(migration()).digest('hex');
}

/** SQL primitive only: the production lifecycle must take its verified safety snapshot
 * and reserve its journal before calling, then initialize/validate external security.
 * This function neither creates a floor nor declares the installation ready.
 */
export function applyAdministrationSchemaMigration(db: Database.Database): void {
  if (inspectAdministrationSchema(db) === 15) return;
  const sql = migration();
  if (!/^BEGIN;\s/.test(sql) || !/COMMIT;\s*$/.test(sql)) throw new Error('ADMINISTRATION_MIGRATION_INVALID');
  db.transaction(() => {
    db.exec(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    const violations = db.pragma('foreign_key_check');
    if (inspectAdministrationSchema(db) !== 15 || !Array.isArray(violations) || violations.length !== 0)
      throw new Error('ADMINISTRATION_SCHEMA_INVALID');
  }).immediate();
}
