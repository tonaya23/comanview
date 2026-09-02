import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../../../../migrations/edge/', import.meta.url));
const migration = () => readFileSync(join(directory, '0014_backup_recovery.sql'), 'utf8');
let expected: { legacy: string; current: string } | undefined;

// Legacy installations have no migration ledger/user_version. Compare their actual
// schema with the immutable SQL migrations, not just the presence of one column.
function fingerprint(db: Database.Database): string {
  return JSON.stringify(
    db
      .prepare(
        `SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`,
      )
      .all(),
  );
}

function referenceSchemas() {
  if (expected) return expected;
  const db = new Database(':memory:');
  try {
    const files = readdirSync(directory)
      .filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 13)
      .sort();
    if (files.length !== 14) throw new Error('UPGRADE_MIGRATIONS_UNAVAILABLE');
    for (const file of files) db.exec(readFileSync(join(directory, file), 'utf8'));
    const legacy = fingerprint(db);
    db.exec(migration());
    expected = { legacy, current: fingerprint(db) };
    return expected;
  } finally {
    db.close();
  }
}

export function inspectRecoveryUpgradeSchema(db: Database.Database): 13 | 14 {
  const version = db.pragma('user_version', { simple: true });
  const actual = fingerprint(db),
    reference = referenceSchemas();
  if (actual === reference.legacy && (version === 0 || version === 13)) return 13;
  if (actual === reference.current && (version === 0 || version === 14)) return 14;
  throw new Error('UPGRADE_SCHEMA_UNSUPPORTED');
}

export function recoveryUpgradeMigrationHash(): string {
  return createHash('sha256').update(migration()).digest('hex');
}

/** Canonical incremental SQL, with its transaction owned by the caller if present. */
export function applyRecoveryUpgradeMigration(db: Database.Database): void {
  if (inspectRecoveryUpgradeSchema(db) === 14) return;
  db.transaction(() => {
    executeRecoveryUpgradeSql(db);
    if (inspectRecoveryUpgradeSchema(db) !== 14) throw new Error('UPGRADE_SCHEMA_INVALID');
  }).immediate();
}

/** Also used on isolated harness copies, after their own fixture preflight. */
export function executeRecoveryUpgradeSql(db: Database.Database): void {
  const sql = migration();
  if (!/^BEGIN;\s/.test(sql) || !/COMMIT;\s*$/.test(sql))
    throw new Error('UPGRADE_MIGRATION_INVALID');
  const body = sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
  db.transaction(() => {
    db.exec(body);
    db.pragma('user_version=14');
  }).immediate();
}
