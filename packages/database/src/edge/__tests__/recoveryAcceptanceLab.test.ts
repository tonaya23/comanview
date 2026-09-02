import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  inspectRecoveryAcceptanceLab,
  inspectRecoveryScenarioLab,
  prepareRecoveryAcceptanceLab,
  recoveryAcceptanceLabPaths,
  createRecoveryAcceptanceCheckpoint,
  restoreRecoveryAcceptanceCheckpoint,
  simulateCorruptRuntimeDatabase,
  simulateMissingRuntimeDatabase,
  tamperLatestRecoveryArtifact,
} from '../recoveryAcceptanceLab.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('Phase 1V recovery acceptance harness', () => {
  it('creates valid baseline/runtime snapshots without replacing the source', async () => {
    const fixture = await createFixture();
    const before = await stat(fixture.sourceDb);
    const report = await prepareRecoveryAcceptanceLab(fixture.input);
    expect(report).toMatchObject({ labReady: true, samePath: false, sqliteIntegrity: 'OK' });
    expect((await stat(fixture.sourceDb)).birthtimeMs).toBe(before.birthtimeMs);
    expect(readValue(fixture.sourceDb)).toBe('source');
    expect(readValue(join(fixture.labRoot, 'baseline', 'edge.db'))).toBe('source');
    expect(readValue(join(fixture.labRoot, 'runtime', 'edge.db'))).toBe('source');
    expect(hasColumn(join(fixture.labRoot, 'runtime', 'edge.db'), 'edge_installations', 'recovery_epoch')).toBe(true);
    expect(hasTable(join(fixture.labRoot, 'runtime', 'edge.db'), 'backup_records')).toBe(true);
  });

  it('aborts when the source DB is missing and never publishes LAB_READY', async () => {
    const fixture = await createFixture();
    await unlink(fixture.sourceDb);
    await expect(prepareRecoveryAcceptanceLab(fixture.input)).rejects.toThrow('RECOVERY_LAB_SOURCE_DB_MISSING');
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot)).rejects.toThrow('RECOVERY_LAB_NOT_READY');
  });

  it('aborts atomically when the snapshot process fails', async () => {
    const fixture = await createFixture();
    await expect(prepareRecoveryAcceptanceLab(fixture.input, { snapshot: async () => { throw new Error('external failure'); } }))
      .rejects.toThrow('external failure');
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot)).rejects.toThrow('RECOVERY_LAB_NOT_READY');
  });

  it('rejects an invalid snapshot before publishing the laboratory', async () => {
    const fixture = await createFixture();
    await expect(prepareRecoveryAcceptanceLab(fixture.input, { snapshot: async (_source, destination) => {
      await writeFile(destination, 'not sqlite');
    } })).rejects.toThrow('RECOVERY_LAB_BASELINE_INVALID');
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot)).rejects.toThrow('RECOVERY_LAB_NOT_READY');
  });

  it('fails preflight when a previously valid runtime DB is missing', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    await unlink(join(fixture.labRoot, 'runtime', 'edge.db'));
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot)).rejects.toThrow('RECOVERY_LAB_RUNTIME_INVALID');
  });

  it('fails preflight when a ready marker points to a legacy pre-1V runtime', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    await unlink(join(fixture.labRoot, 'runtime', 'edge.db'));
    await copyLegacyDatabase(fixture.sourceDb, join(fixture.labRoot, 'runtime', 'edge.db'));
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot))
      .rejects.toThrow('RECOVERY_LAB_RUNTIME_SCHEMA_INVALID');
  });

  it('rejects every destructive path outside the exact RecoveryAcceptance lab', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-lab-unsafe-')); roots.push(root);
    expect(() => recoveryAcceptanceLabPaths(join(root, 'RecoveryAcceptance'), join(root, 'source')))
      .toThrow('RECOVERY_LAB_UNSAFE_PATH');
  });

  it('restores a valid checkpoint after an isolated destructive scenario', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    await createRecoveryAcceptanceCheckpoint(fixture.acceptanceRoot, fixture.labRoot);
    await simulateMissingRuntimeDatabase(fixture.acceptanceRoot, fixture.labRoot);
    expect(await stat(join(fixture.labRoot, 'runtime', 'edge.db')).then(() => true).catch(() => false)).toBe(false);
    await restoreRecoveryAcceptanceCheckpoint(fixture.acceptanceRoot, fixture.labRoot);
    await expect(inspectRecoveryAcceptanceLab(fixture.acceptanceRoot, fixture.labRoot)).resolves.toMatchObject({ labReady: true });
  });

  it('creates a tampered copy while preserving the original artifact', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    const artifact = join(fixture.labRoot, 'runtime', 'backups-local', 'backup.cvbackup');
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'manifest.json'), JSON.stringify({ backupId: '01991a00-0000-7000-8000-000000000901' }));
    await writeFile(join(artifact, 'database.enc'), Buffer.from('encrypted-fixture'));
    const original = await readFile(join(artifact, 'database.enc'));
    const tampered = await tamperLatestRecoveryArtifact(fixture.acceptanceRoot, fixture.labRoot);
    expect(await readFile(join(artifact, 'database.enc'))).toEqual(original);
    expect(await readFile(join(tampered.artifactPath, 'database.enc'))).not.toEqual(original);
  });

  it('recognizes only an established isolated missing-DB recovery scenario', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    await writeFile(join(fixture.labRoot, 'runtime', 'security-floor.bin'), 'dpapi-fixture');
    await simulateMissingRuntimeDatabase(fixture.acceptanceRoot, fixture.labRoot);
    await expect(inspectRecoveryScenarioLab(fixture.acceptanceRoot, fixture.labRoot)).resolves.toMatchObject({
      runtimeDbHealth: 'MISSING', recoveryLabReady: true, securityFloorPresent: true,
    });
  });

  it('creates a deterministic corrupt-DB scenario while preserving original evidence', async () => {
    const fixture = await createFixture();
    await prepareRecoveryAcceptanceLab(fixture.input);
    await writeFile(join(fixture.labRoot, 'runtime', 'security-floor.bin'), 'dpapi-fixture');
    const evidence = await simulateCorruptRuntimeDatabase(fixture.acceptanceRoot, fixture.labRoot);
    await expect(inspectRecoveryScenarioLab(fixture.acceptanceRoot, fixture.labRoot)).resolves.toMatchObject({
      runtimeDbHealth: 'CORRUPT', recoveryLabReady: true,
    });
    await expect(stat(join(evidence, 'edge-before-corruption.db'))).resolves.toMatchObject({ size: expect.any(Number) });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cv-recovery-lab-')); roots.push(root);
  const sourceDb = join(root, 'source.db');
  const sourceSecret = join(root, 'source.secret.json');
  const settingsPath = join(root, 'settings.json');
  const acceptanceRoot = join(root, 'RecoveryAcceptance');
  const labRoot = join(acceptanceRoot, 'phase-1v');
  const sqlite = new Database(sourceDb);
  sqlite.pragma('journal_mode=WAL');
  for (const migration of legacyMigrations) sqlite.exec(readFileSync(join(migrationsRoot, migration), 'utf8'));
  sqlite.exec('CREATE TABLE sample(value TEXT NOT NULL); INSERT INTO sample VALUES (\'source\');');
  sqlite.close();
  await writeFile(sourceSecret, '{"secret":"fixture-only"}');
  await writeFile(settingsPath, JSON.stringify({ edgeDatabasePath: sourceDb, edgeSecretPath: sourceSecret }));
  return { sourceDb, acceptanceRoot, labRoot, input: { environment: 'test', settingsPath, acceptanceRoot, labRoot } };
}

const migrationsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations/edge');
const legacyMigrations = [
  '0000_initial.sql', '0001_payments_cash.sql', '0002_order_item_special_instructions.sql',
  '0003_printing.sql', '0004_kds.sql', '0005_local_auth.sql', '0006_audit_log.sql',
  '0007_cash_operations_closure.sql', '0008_tables_waiter.sql', '0009_operational_realtime.sql',
  '0010_sync_foundation.sql', '0011_edge_provisioning.sql', '0012_signed_licensing_configuration.sql',
  '0013_device_pairing_readiness.sql',
];

async function copyLegacyDatabase(source: string, destination: string): Promise<void> {
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  try { await sourceDb.backup(destination); } finally { sourceDb.close(); }
}

function readValue(path: string): string {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try { return (sqlite.prepare('SELECT value FROM sample').get() as { value: string }).value; }
  finally { sqlite.close(); }
}

function hasTable(path: string, table: string): boolean {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try { return Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
  finally { sqlite.close(); }
}

function hasColumn(path: string, table: string, column: string): boolean {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try { return (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).some((entry) => entry.name === column); }
  finally { sqlite.close(); }
}
