import Database from 'better-sqlite3';
import { executeRecoveryUpgradeSql } from './recoveryUpgradeSchema.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const READY_FILE = '.lab-ready.json';
const CHECKPOINT_READY_FILE = '.checkpoint-ready.json';

export interface RecoveryAcceptanceLabPaths {
  acceptanceRoot: string;
  labRoot: string;
  baselineRoot: string;
  runtimeRoot: string;
  checkpointRoot: string;
  baselineDb: string;
  runtimeDb: string;
  baselineSecret: string;
  runtimeSecret: string;
}

interface LabReadyMarker {
  formatVersion: 1;
  environment: string;
  sourceDb: string;
  labRoot: string;
  runtimeDb: string;
  createdAt: string;
  sourceStableDuringSnapshot: true;
}

export interface LabPreflightReport {
  labRoot: string;
  sourceDb: string;
  runtimeDb: string;
  sourceDbExists: true;
  runtimeDbExists: true;
  samePath: false;
  sqliteIntegrity: 'OK';
  edgeSecretPresent: true;
  labReady: true;
}

export interface RecoveryScenarioPreflightReport {
  labRoot: string;
  runtimeDb: string;
  runtimeDbHealth: 'MISSING' | 'CORRUPT';
  edgeSecretPresent: true;
  securityFloorPresent: true;
  recoveryLabReady: true;
}

interface PrepareDependencies {
  snapshot?: (source: Database.Database, destination: string) => Promise<void>;
}

export function recoveryAcceptanceLabPaths(acceptanceRoot: string, labRoot: string): RecoveryAcceptanceLabPaths {
  const safeAcceptanceRoot = resolve(acceptanceRoot);
  const safeLabRoot = resolve(labRoot);
  if (!samePath(safeLabRoot, join(safeAcceptanceRoot, 'phase-1v'))) {
    throw new Error('RECOVERY_LAB_UNSAFE_PATH');
  }
  return {
    acceptanceRoot: safeAcceptanceRoot,
    labRoot: safeLabRoot,
    baselineRoot: join(safeLabRoot, 'baseline'),
    runtimeRoot: join(safeLabRoot, 'runtime'),
    checkpointRoot: join(safeLabRoot, 'verified-checkpoint'),
    baselineDb: join(safeLabRoot, 'baseline', 'edge.db'),
    runtimeDb: join(safeLabRoot, 'runtime', 'edge.db'),
    baselineSecret: join(safeLabRoot, 'baseline', 'edge-secret.json'),
    runtimeSecret: join(safeLabRoot, 'runtime', 'edge-secret.json'),
  };
}

export async function prepareRecoveryAcceptanceLab(input: {
  environment: string;
  settingsPath: string;
  acceptanceRoot: string;
  labRoot: string;
}, dependencies: PrepareDependencies = {}): Promise<LabPreflightReport> {
  const paths = recoveryAcceptanceLabPaths(input.acceptanceRoot, input.labRoot);
  const settings = await readDevelopmentSettings(input.settingsPath);
  const sourceDb = resolve(settings.edgeDatabasePath);
  const sourceSecret = resolve(settings.edgeSecretPath);
  await requireNonEmptyFile(sourceDb, 'RECOVERY_LAB_SOURCE_DB_MISSING');
  await requireNonEmptyFile(sourceSecret, 'RECOVERY_LAB_SOURCE_SECRET_MISSING');
  if (samePath(sourceDb, paths.runtimeDb) || isPathInside(sourceDb, paths.labRoot)) {
    throw new Error('RECOVERY_LAB_SOURCE_INSIDE_LAB');
  }

  await mkdir(paths.acceptanceRoot, { recursive: true });
  const stagingRoot = join(paths.acceptanceRoot, `.phase-1v.preparing-${process.pid}-${randomUUID()}`);
  const stagedBaseline = join(stagingRoot, 'baseline');
  const stagedRuntime = join(stagingRoot, 'runtime');
  const stagedBaselineDb = join(stagedBaseline, 'edge.db');
  const stagedRuntimeDb = join(stagedRuntime, 'edge.db');
  const oldRoot = join(paths.acceptanceRoot, `.phase-1v.previous-${process.pid}-${randomUUID()}`);
  let oldMoved = false;

  try {
    await mkdir(stagedBaseline, { recursive: true });
    await mkdir(stagedRuntime, { recursive: true });
    let before: ReturnType<typeof logicalSourceFingerprint>;
    const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
    try {
      source.pragma('query_only=ON');
      assertSqliteIntegrity(source, 'quick_check', 'RECOVERY_LAB_SOURCE_INVALID');
      before = logicalSourceFingerprint(source);
      await (dependencies.snapshot ?? defaultSnapshot)(source, stagedBaselineDb);
      const changes = source.prepare('SELECT total_changes() total').get() as { total: number };
      if (changes.total !== 0) throw new Error('RECOVERY_LAB_SOURCE_CHANGED_DURING_SNAPSHOT');
    } finally {
      source.close();
    }
    const sourceAfter = new Database(sourceDb, { readonly: true, fileMustExist: true });
    try {
      sourceAfter.pragma('query_only=ON');
      assertSqliteIntegrity(sourceAfter, 'quick_check', 'RECOVERY_LAB_SOURCE_INVALID');
      if (JSON.stringify(before) !== JSON.stringify(logicalSourceFingerprint(sourceAfter))) {
        throw new Error('RECOVERY_LAB_SOURCE_CHANGED_DURING_SNAPSHOT');
      }
    } finally {
      sourceAfter.close();
    }

    await validateSqliteFile(stagedBaselineDb, 'RECOVERY_LAB_BASELINE_INVALID');
    await migrateSnapshotToRecoverySchema(stagedBaselineDb);
    await validateRecoverySchema(stagedBaselineDb, 'RECOVERY_LAB_BASELINE_SCHEMA_INVALID');
    await copyFile(sourceSecret, join(stagedBaseline, 'edge-secret.json'));
    await requireNonEmptyFile(join(stagedBaseline, 'edge-secret.json'), 'RECOVERY_LAB_SECRET_COPY_FAILED');
    await copyFile(stagedBaselineDb, stagedRuntimeDb);
    await copyFile(join(stagedBaseline, 'edge-secret.json'), join(stagedRuntime, 'edge-secret.json'));
    await validateSqliteFile(stagedRuntimeDb, 'RECOVERY_LAB_RUNTIME_INVALID');
    await validateRecoverySchema(stagedRuntimeDb, 'RECOVERY_LAB_RUNTIME_SCHEMA_INVALID');
    await requireNonEmptyFile(join(stagedRuntime, 'edge-secret.json'), 'RECOVERY_LAB_SECRET_COPY_FAILED');

    const marker: LabReadyMarker = {
      formatVersion: 1,
      environment: input.environment,
      sourceDb,
      labRoot: paths.labRoot,
      runtimeDb: paths.runtimeDb,
      createdAt: new Date().toISOString(),
      sourceStableDuringSnapshot: true,
    };
    await writeFile(join(stagingRoot, READY_FILE), JSON.stringify(marker, null, 2), { encoding: 'utf8', mode: 0o600 });

    if (await exists(paths.labRoot)) {
      await rename(paths.labRoot, oldRoot);
      oldMoved = true;
    }
    await rename(stagingRoot, paths.labRoot);
    if (oldMoved) await rm(oldRoot, { recursive: true, force: true });
    return inspectRecoveryAcceptanceLab(paths.acceptanceRoot, paths.labRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    if (oldMoved && !(await exists(paths.labRoot)) && (await exists(oldRoot))) await rename(oldRoot, paths.labRoot);
    throw error;
  }
}

export async function inspectRecoveryAcceptanceLab(acceptanceRoot: string, labRoot: string): Promise<LabPreflightReport> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  const marker = await readReadyMarker(paths.labRoot);
  await validateSqliteFile(marker.sourceDb, 'RECOVERY_LAB_SOURCE_INVALID');
  await validateSqliteFile(paths.baselineDb, 'RECOVERY_LAB_BASELINE_INVALID');
  await validateRecoverySchema(paths.baselineDb, 'RECOVERY_LAB_BASELINE_SCHEMA_INVALID');
  await validateSqliteFile(paths.runtimeDb, 'RECOVERY_LAB_RUNTIME_INVALID');
  await validateRecoverySchema(paths.runtimeDb, 'RECOVERY_LAB_RUNTIME_SCHEMA_INVALID');
  await requireNonEmptyFile(paths.baselineSecret, 'RECOVERY_LAB_SECRET_COPY_FAILED');
  await requireNonEmptyFile(paths.runtimeSecret, 'RECOVERY_LAB_SECRET_COPY_FAILED');
  if (samePath(marker.sourceDb, paths.runtimeDb)) throw new Error('RECOVERY_LAB_SOURCE_EQUALS_RUNTIME');
  return {
    labRoot: paths.labRoot,
    sourceDb: resolve(marker.sourceDb),
    runtimeDb: paths.runtimeDb,
    sourceDbExists: true,
    runtimeDbExists: true,
    samePath: false,
    sqliteIntegrity: 'OK',
    edgeSecretPresent: true,
    labReady: true,
  };
}

export async function inspectRecoveryScenarioLab(acceptanceRoot: string, labRoot: string): Promise<RecoveryScenarioPreflightReport> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  const marker = await readReadyMarker(paths.labRoot);
  await validateSqliteFile(marker.sourceDb, 'RECOVERY_LAB_SOURCE_INVALID');
  await requireNonEmptyFile(paths.runtimeSecret, 'RECOVERY_LAB_SECRET_COPY_FAILED');
  await requireNonEmptyFile(join(paths.runtimeRoot, 'security-floor.bin'), 'RECOVERY_LAB_SECURITY_FLOOR_MISSING');
  let runtimeDbHealth: 'MISSING' | 'CORRUPT';
  if (!(await exists(paths.runtimeDb))) runtimeDbHealth = 'MISSING';
  else {
    try {
      await validateSqliteFile(paths.runtimeDb, 'RECOVERY_LAB_RUNTIME_INVALID');
      throw new Error('RECOVERY_LAB_RECOVERY_SCENARIO_NOT_ACTIVE');
    } catch (error) {
      if (error instanceof Error && error.message === 'RECOVERY_LAB_RECOVERY_SCENARIO_NOT_ACTIVE') throw error;
      runtimeDbHealth = 'CORRUPT';
    }
  }
  return { labRoot: paths.labRoot, runtimeDb: paths.runtimeDb, runtimeDbHealth,
    edgeSecretPresent: true, securityFloorPresent: true, recoveryLabReady: true };
}

export async function createRecoveryAcceptanceCheckpoint(acceptanceRoot: string, labRoot: string): Promise<void> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  const temporary = join(paths.labRoot, `.checkpoint.preparing-${process.pid}-${randomUUID()}`);
  try {
    await cp(paths.runtimeRoot, temporary, { recursive: true, force: true });
    await validateSqliteFile(join(temporary, 'edge.db'), 'RECOVERY_LAB_CHECKPOINT_INVALID');
    await requireNonEmptyFile(join(temporary, 'edge-secret.json'), 'RECOVERY_LAB_CHECKPOINT_INVALID');
    await writeFile(join(temporary, CHECKPOINT_READY_FILE), JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString() }), { mode: 0o600 });
    await rm(paths.checkpointRoot, { recursive: true, force: true });
    await rename(temporary, paths.checkpointRoot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreRecoveryAcceptanceCheckpoint(acceptanceRoot: string, labRoot: string): Promise<void> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await requireNonEmptyFile(join(paths.checkpointRoot, CHECKPOINT_READY_FILE), 'RECOVERY_LAB_CHECKPOINT_MISSING');
  await validateSqliteFile(join(paths.checkpointRoot, 'edge.db'), 'RECOVERY_LAB_CHECKPOINT_INVALID');
  await requireNonEmptyFile(join(paths.checkpointRoot, 'edge-secret.json'), 'RECOVERY_LAB_CHECKPOINT_INVALID');
  const temporary = join(paths.labRoot, `.runtime.preparing-${process.pid}-${randomUUID()}`);
  const previous = join(paths.labRoot, `.runtime.previous-${process.pid}-${randomUUID()}`);
  let previousMoved = false;
  try {
    await cp(paths.checkpointRoot, temporary, { recursive: true, force: true });
    await rm(join(temporary, CHECKPOINT_READY_FILE), { force: true });
    await validateSqliteFile(join(temporary, 'edge.db'), 'RECOVERY_LAB_RUNTIME_INVALID');
    await rename(paths.runtimeRoot, previous);
    previousMoved = true;
    await rename(temporary, paths.runtimeRoot);
    await rm(previous, { recursive: true, force: true });
    await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    if (previousMoved && !(await exists(paths.runtimeRoot)) && (await exists(previous))) await rename(previous, paths.runtimeRoot);
    throw error;
  }
}

export async function simulateMissingRuntimeDatabase(acceptanceRoot: string, labRoot: string): Promise<string> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  const evidence = join(paths.runtimeRoot, 'evidence', `missing-${timestamp()}`);
  await mkdir(evidence, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${paths.runtimeDb}${suffix}`;
    if (await exists(source)) await rename(source, join(evidence, `edge.db${suffix}`));
  }
  if (await exists(paths.runtimeDb)) throw new Error('RECOVERY_LAB_MISSING_SIMULATION_FAILED');
  return evidence;
}

export async function simulateCorruptRuntimeDatabase(acceptanceRoot: string, labRoot: string): Promise<string> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  const evidence = join(paths.runtimeRoot, 'evidence', `corrupt-${timestamp()}`);
  await mkdir(evidence, { recursive: true });
  await copyFile(paths.runtimeDb, join(evidence, 'edge-before-corruption.db'));
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${paths.runtimeDb}${suffix}`;
    if (await exists(sidecar)) await rename(sidecar, join(evidence, `edge-before-corruption.db${suffix}`));
  }
  const handle = await open(paths.runtimeDb, 'r+');
  try {
    const first = Buffer.alloc(1);
    await handle.read(first, 0, 1, 0);
    first[0] = first[0]! ^ 0xff;
    await handle.write(first, 0, 1, 0);
  } finally {
    await handle.close();
  }
  return evidence;
}

export async function tamperLatestRecoveryArtifact(acceptanceRoot: string, labRoot: string): Promise<{ backupId: string; artifactPath: string }> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  const source = await latestArtifact(paths.runtimeRoot);
  const targetRoot = join(paths.runtimeRoot, 'tampered');
  const target = join(targetRoot, basename(source.path));
  await mkdir(targetRoot, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await cp(source.path, target, { recursive: true, force: true });
  const payloadPath = join(target, 'database.enc');
  const payload = await readFile(payloadPath);
  if (payload.length === 0) throw new Error('RECOVERY_LAB_BACKUP_ARTIFACT_INVALID');
  payload[Math.floor(payload.length / 2)]! ^= 0x01;
  await writeFile(payloadPath, payload, { mode: 0o600 });
  const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')) as { backupId?: unknown };
  if (typeof manifest.backupId !== 'string') throw new Error('RECOVERY_LAB_BACKUP_ARTIFACT_INVALID');
  return { backupId: manifest.backupId, artifactPath: target };
}

export async function inspectLatestRecoveryArtifact(acceptanceRoot: string, labRoot: string): Promise<{ backupId: string; artifactPath: string }> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot);
  const artifact = await latestArtifact(paths.runtimeRoot);
  const manifest = JSON.parse(await readFile(join(artifact.path, 'manifest.json'), 'utf8')) as { backupId?: unknown };
  if (typeof manifest.backupId !== 'string') throw new Error('RECOVERY_LAB_BACKUP_ARTIFACT_INVALID');
  return { backupId: manifest.backupId, artifactPath: artifact.path };
}

export async function cleanupRecoveryAcceptanceLab(acceptanceRoot: string, labRoot: string): Promise<void> {
  const paths = recoveryAcceptanceLabPaths(acceptanceRoot, labRoot);
  await rm(paths.labRoot, { recursive: true, force: true });
}

async function readDevelopmentSettings(path: string): Promise<{ edgeDatabasePath: string; edgeSecretPath: string }> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new Error('RECOVERY_LAB_SETTINGS_INVALID');
  }
  if (!value || typeof value !== 'object') throw new Error('RECOVERY_LAB_SETTINGS_INVALID');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['edgeDatabasePath'] !== 'string' || candidate['edgeDatabasePath'].trim() === '' ||
      typeof candidate['edgeSecretPath'] !== 'string' || candidate['edgeSecretPath'].trim() === '') {
    throw new Error('RECOVERY_LAB_SETTINGS_INVALID');
  }
  return { edgeDatabasePath: candidate['edgeDatabasePath'], edgeSecretPath: candidate['edgeSecretPath'] };
}

async function defaultSnapshot(source: Database.Database, destination: string): Promise<void> {
  await source.backup(destination);
}

async function validateSqliteFile(path: string, code: string): Promise<void> {
  await requireNonEmptyFile(path, code);
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true });
    sqlite.pragma('query_only=ON');
    assertSqliteIntegrity(sqlite, 'integrity_check', code);
  } catch {
    throw new Error(code);
  } finally {
    sqlite?.close();
  }
}

async function migrateSnapshotToRecoverySchema(path: string): Promise<void> {
  const sqlite = new Database(path, { fileMustExist: true });
  try {
    sqlite.pragma('foreign_keys=ON');
    const state = recoverySchemaState(sqlite);
    if (state === 'CURRENT') return;
    if (state !== 'LEGACY') throw new Error('RECOVERY_LAB_BASELINE_SCHEMA_INVALID');
    executeRecoveryUpgradeSql(sqlite);
    if (recoverySchemaState(sqlite) !== 'CURRENT') {
      throw new Error('RECOVERY_LAB_BASELINE_SCHEMA_INVALID');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'RECOVERY_LAB_BASELINE_SCHEMA_INVALID') throw error;
    throw new Error('RECOVERY_LAB_BASELINE_SCHEMA_INVALID');
  } finally {
    sqlite.close();
  }
}

async function validateRecoverySchema(path: string, code: string): Promise<void> {
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true });
    sqlite.pragma('query_only=ON');
    if (recoverySchemaState(sqlite) !== 'CURRENT') throw new Error(code);
  } catch {
    throw new Error(code);
  } finally {
    sqlite?.close();
  }
}

function recoverySchemaState(sqlite: Database.Database): 'LEGACY' | 'CURRENT' | 'INVALID' {
  const hasEdgeInstallations = hasTable(sqlite, 'edge_installations');
  const hasEventLog = hasTable(sqlite, 'event_log');
  if (!hasEdgeInstallations || !hasEventLog) return 'INVALID';
  const markers = [
    hasColumn(sqlite, 'edge_installations', 'recovery_epoch'),
    hasColumn(sqlite, 'event_log', 'recovery_epoch'),
    hasTable(sqlite, 'backup_records'),
    hasTable(sqlite, 'backup_runtime'),
  ];
  if (markers.every(Boolean)) return 'CURRENT';
  if (markers.every((value) => !value)) return 'LEGACY';
  return 'INVALID';
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).some((entry) => entry.name === column);
}

function assertSqliteIntegrity(sqlite: Database.Database, pragma: 'quick_check' | 'integrity_check', code: string): void {
  const rows = sqlite.pragma(pragma) as Array<Record<string, string>>;
  if (rows.length !== 1 || rows[0]?.[pragma] !== 'ok') throw new Error(code);
}

async function requireNonEmptyFile(path: string, code: string): Promise<void> {
  try {
    const value = await stat(path);
    if (!value.isFile() || value.size <= 0) throw new Error(code);
  } catch {
    throw new Error(code);
  }
}

function logicalSourceFingerprint(sqlite: Database.Database): Record<string, number | string> {
  const schema = sqlite.prepare(`SELECT type,name,tbl_name,COALESCE(sql,'') sql FROM sqlite_master
    ORDER BY type,name,tbl_name`).all();
  return {
    schemaVersion: Number(sqlite.pragma('schema_version', { simple: true })),
    userVersion: Number(sqlite.pragma('user_version', { simple: true })),
    applicationId: Number(sqlite.pragma('application_id', { simple: true })),
    pageCount: Number(sqlite.pragma('page_count', { simple: true })),
    freelistCount: Number(sqlite.pragma('freelist_count', { simple: true })),
    schemaSha256: createHash('sha256').update(JSON.stringify(schema), 'utf8').digest('hex'),
  };
}

async function readReadyMarker(labRoot: string): Promise<LabReadyMarker> {
  try {
    const value = JSON.parse(await readFile(join(labRoot, READY_FILE), 'utf8')) as Partial<LabReadyMarker>;
    if (value.formatVersion !== 1 || typeof value.sourceDb !== 'string' || typeof value.runtimeDb !== 'string' ||
        value.sourceStableDuringSnapshot !== true || resolve(value.labRoot ?? '') !== resolve(labRoot)) {
      throw new Error('RECOVERY_LAB_NOT_READY');
    }
    return value as LabReadyMarker;
  } catch {
    throw new Error('RECOVERY_LAB_NOT_READY');
  }
}

async function findArtifacts(root: string): Promise<Array<{ path: string; modifiedAt: number }>> {
  const found: Array<{ path: string; modifiedAt: number }> = [];
  async function visit(directory: string): Promise<void> {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.cvbackup')) {
        found.push({ path, modifiedAt: (await stat(path)).mtimeMs });
      } else if (!entry.name.startsWith('.recovery-staging') && entry.name !== 'tampered' && entry.name !== 'evidence') {
        await visit(path);
      }
    }
  }
  await visit(root);
  return found;
}

async function latestArtifact(runtimeRoot: string): Promise<{ path: string; modifiedAt: number }> {
  const artifacts = await findArtifacts(runtimeRoot);
  if (artifacts.length === 0) throw new Error('RECOVERY_LAB_BACKUP_ARTIFACT_MISSING');
  return artifacts.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]!;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32' ? resolve(value).toLocaleLowerCase('en-US') : resolve(value);
  return normalize(left) === normalize(right);
}

function isPathInside(candidate: string, root: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value !== '' && !value.startsWith('..') && !isAbsolute(value);
}
