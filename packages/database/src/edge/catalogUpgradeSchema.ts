import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EntityId } from '@comanview/domain';
import { inspectAdministrationSchema } from './administrationUpgradeSchema.js';

const directory = fileURLToPath(new URL('../../../../migrations/edge/', import.meta.url));
const migration = () => readFileSync(join(directory, '0016_commercial_catalog.sql'), 'utf8');
let reference: string | undefined;

/** Version 1: NFKC, outer trim, Unicode uppercase independent of host locale.
 * Visible legacy values are never rewritten. Interior spacing and punctuation stay.
 */
export function normalizeCatalogSku(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error('SKU_INVALID');
  const normalized = value.normalize('NFKC').trim();
  return normalized.length ? normalized.toUpperCase() : null;
}

function fingerprint(db: Database.Database): string {
  return JSON.stringify(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all());
}

function referenceSchema(): string {
  if (reference !== undefined) return reference;
  const db = new Database(':memory:');
  try {
    const files = readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 16).sort();
    if (files.length !== 17) throw new Error('CATALOG_MIGRATIONS_UNAVAILABLE');
    for (const file of files) db.exec(readFileSync(join(directory, file), 'utf8'));
    reference = fingerprint(db);
    return reference;
  } finally { db.close(); }
}

export function inspectCatalogSchema(db: Database.Database): 15 | 16 {
  if (db.pragma('user_version', { simple: true }) === 16) {
    if (fingerprint(db) !== referenceSchema()) throw new Error('CATALOG_SCHEMA_INVALID');
    return 16;
  }
  if (inspectAdministrationSchema(db) === 15) return 15;
  throw new Error('CATALOG_SCHEMA_UNSUPPORTED');
}

export function catalogMigrationDigest(): string {
  // Include normalization semantics in the lifecycle digest, not just SQL.
  return createHash('sha256').update('catalog-normalization-v1\n' + migration()).digest('hex');
}

export function validateCatalogBaseline(db: Database.Database): void {
  if (inspectCatalogSchema(db) !== 16) throw new Error('CATALOG_SCHEMA_INVALID');
  const category = db.prepare("SELECT id,active FROM categories WHERE system_key='UNCATEGORIZED'").get() as {id:string;active:number}|undefined;
  if (!category || category.active !== 1 || db.prepare('SELECT id FROM products WHERE category_id IS NULL LIMIT 1').get())
    throw new Error('CATALOG_BASELINE_INVALID');
  EntityId.fromString(category.id);
  const state = db.prepare("SELECT generation,normalization_version FROM catalog_state WHERE singleton_key='PRIMARY'").get() as {generation:number;normalization_version:number}|undefined;
  if (!state || !Number.isSafeInteger(state.generation) || state.generation < 0 || state.normalization_version !== 1)
    throw new Error('CATALOG_BASELINE_INVALID');
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('CATALOG_REFERENCE_INVALID');
  const rows = db.prepare('SELECT id,sku,sku_key FROM products ORDER BY id').all() as Array<{id:string;sku:string|null;sku_key:string|null}>;
  const owners = new Map<string,string[]>();
  for (const row of rows) {
    if (normalizeCatalogSku(row.sku) !== row.sku_key) throw new Error('CATALOG_SKU_STATE_INVALID');
    if (row.sku_key !== null) owners.set(row.sku_key,[...(owners.get(row.sku_key) ?? []),row.id]);
  }
  const claims = db.prepare('SELECT sku_key,product_id,state FROM catalog_sku_claims').all() as Array<{sku_key:string;product_id:string|null;state:string}>;
  if ([...owners.keys()].some(key=>!claims.some(claim=>claim.sku_key===key))) throw new Error('CATALOG_SKU_STATE_INVALID');
  for (const claim of claims) {
    const products = owners.get(claim.sku_key);
    // Ambiguous legacy keys remain reserved even when members explicitly move away.
    // Never elect the last remaining Product as an implicit winner.
    if (claim.state==='CONFLICT'&&claim.product_id===null) continue;
    if (!products||products.length!==1||claim.state!=='CLAIMED'||claim.product_id!==products[0]) throw new Error('CATALOG_SKU_STATE_INVALID');
  }
}

/** Canonical SQL + data transition. Caller owns productive preflight/safety journal.
 * No Personnel bootstrap, credentials, bindings, epoch or financial rows are touched.
 */
export function applyCatalogSchemaMigration(db: Database.Database): void {
  if (inspectCatalogSchema(db) === 16) { validateCatalogBaseline(db); return; }
  const sql = migration();
  if (!/^BEGIN;\s/.test(sql) || !/COMMIT;\s*$/.test(sql)) throw new Error('CATALOG_MIGRATION_INVALID');
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('CATALOG_DATABASE_INVALID');
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('CATALOG_REFERENCE_INVALID');
  // Preflight before DDL. Duplicate legacy keys are allowed, invalid controls are not.
  const products = db.prepare('SELECT id,sku FROM products ORDER BY id').all() as Array<{id:string;sku:string|null}>;
  const normalized = products.map(row => ({...row, key: normalizeCatalogSku(row.sku)}));
  db.transaction(() => {
    db.exec(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    const id = EntityId.generate().toString();
    db.prepare("INSERT INTO categories(id,name,active,system_key) VALUES(?,'Sin categoría',1,'UNCATEGORIZED')").run(id);
    db.prepare('UPDATE products SET category_id=? WHERE category_id IS NULL').run(id);
    const update = db.prepare('UPDATE products SET sku_key=? WHERE id=?');
    for (const row of normalized) update.run(row.key, row.id);
    db.exec(`INSERT INTO catalog_sku_claims(sku_key,product_id,state)
      SELECT sku_key,CASE WHEN count(*)=1 THEN min(id) ELSE NULL END,
      CASE WHEN count(*)=1 THEN 'CLAIMED' ELSE 'CONFLICT' END
      FROM products WHERE sku_key IS NOT NULL GROUP BY sku_key`);
    validateCatalogBaseline(db);
  }).immediate();
}
