/** Manual acceptance tooling only. Never imported by the Edge startup. */
import Database from 'better-sqlite3';
import { createHash, createPublicKey } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
  readdir,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, basename } from 'node:path';
import { inspectRecoveryUpgradeSchema } from '@comanview/database';
import {
  createEdgeSecretStore,
  WindowsDpapiEdgeSecretStore,
} from './modules/provisioning/EdgeSecretStore.js';
import {
  WindowsDpapiRecoverySecurityStore,
  mergeRecoverySecurityMetadata,
  isDeviceRevokedByFloor,
  type RecoverySecurityFloor,
} from './modules/backup/RecoverySecurityStore.js';

const READY = '.upgrade-lab.json';
const FIRST = '.first-start.json';
const unchangedTables = [
  'orders',
  'order_items',
  'order_item_modifiers',
  'rounds',
  'payments',
  'cash_sessions',
  'cash_movements',
  'cash_reports',
  'cash_registers',
  'event_log',
  'audit_log',
  'categories',
  'products',
  'tax_profiles',
  'users',
  'roles',
  'user_roles',
  'installation_state',
  'edge_installations',
];
type Digest = { rows: number; sha256: string };
type Binding = { tenantId: string; locationId: string; edgeId: string; credentialId: string };
interface Marker {
  version: 1;
  sourceDb: string;
  sourceSecret: string;
  sourceStore: 'development-file' | 'windows-dpapi';
  sourceHashes: Record<string, string | null>;
  binding: Binding;
  publicKey: string;
  kid: string;
  baselineHashes: Record<string, Digest>;
}
export function upgradeLabPaths(acceptanceRoot: string, labRoot: string) {
  const parent = resolve(acceptanceRoot),
    root = resolve(labRoot);
  if (
    !/^phase-1v-upgrade(?:-[a-z0-9-]{1,32})?$/.test(basename(root)) ||
    !same(dirname(root), parent)
  )
    throw new Error('UPGRADE_LAB_UNSAFE_PATH');
  return {
    parent,
    root,
    baseline: join(root, 'baseline', 'edge.db'),
    db: join(root, 'runtime', 'edge.db'),
    secret: join(root, 'runtime', 'edge-secret.bin'),
    floor: join(root, 'runtime', 'security-floor.bin'),
    backups: join(root, 'runtime', 'backups-local'),
    safety: join(root, 'runtime', '.upgrade-1v'),
    ready: join(root, READY),
  };
}
type Paths = ReturnType<typeof upgradeLabPaths>;
export async function prepareUpgradeLab(input: {
  acceptanceRoot: string;
  labRoot: string;
  settingsPath: string;
  publicKeyPath: string;
  kid: string;
  sourceStore: 'development-file' | 'windows-dpapi';
}) {
  const p = upgradeLabPaths(input.acceptanceRoot, input.labRoot);
  await noLinks(p.parent);
  if (await exists(p.root)) throw new Error('UPGRADE_LAB_ALREADY_EXISTS');
  const settings = JSON.parse(await readFile(input.settingsPath, 'utf8')) as {
    edgeDatabasePath?: unknown;
    edgeSecretPath?: unknown;
  };
  if (
    typeof settings.edgeDatabasePath !== 'string' ||
    typeof settings.edgeSecretPath !== 'string' ||
    !isAbsolute(settings.edgeDatabasePath) ||
    !isAbsolute(settings.edgeSecretPath)
  )
    throw new Error('UPGRADE_LAB_SETTINGS_INVALID');
  const sourceDb = await realpath(settings.edgeDatabasePath),
    sourceSecret = await realpath(settings.edgeSecretPath);
  if (inside(sourceDb, p.parent) || inside(sourceSecret, p.parent) || same(sourceDb, sourceSecret))
    throw new Error('UPGRADE_LAB_SOURCE_UNSAFE');
  await noLinks(sourceDb);
  await noLinks(sourceSecret);
  for (const suffix of ['-wal', '-shm', '-journal']) await noLinks(sourceDb + suffix);
  const publicKey = await readFile(input.publicKeyPath, 'utf8');
  if (createPublicKey(publicKey).asymmetricKeyType !== 'ed25519' || !input.kid)
    throw new Error('UPGRADE_LAB_KEYRING_INVALID');
  const sourceHashes = await originalHashes(sourceDb, sourceSecret);
  if (process.platform !== 'win32') throw new Error('UPGRADE_LAB_WINDOWS_REQUIRED');
  await mkdir(p.parent, { recursive: true });
  await mkdir(p.root); // exclusive creation; preserve even incomplete attempts
  await promisify(execFile)(
    'icacls.exe',
    [p.root, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`],
    { windowsHide: true },
  );
  const capture = join(p.root, 'capture'),
    processing = join(p.root, 'processing');
  await mkdir(capture);
  // No SQLite connection ever opens the original. Win32 sharing exclusion must
  // be acquired for ALL existing source files before capturing any bytes.
  try {
    await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('../../../scripts/Phase1V-UpgradeCapture.ps1', import.meta.url)),
        '-SourceDatabase',
        sourceDb,
        '-SourceSecret',
        sourceSecret,
        '-CaptureDirectory',
        capture,
      ],
      { windowsHide: true },
    );
  } catch (error) {
    const output = String((error as { stdout?: string }).stdout ?? '');
    throw new Error(output.match(/UPGRADE_LAB_[A-Z_]+/)?.[0] ?? 'UPGRADE_LAB_CAPTURE_FAILED');
  }
  const captured = JSON.parse(await readFile(join(capture, 'capture.json'), 'utf8')) as {
    hashes: typeof sourceHashes;
  };
  equal(captured.hashes, sourceHashes, 'UPGRADE_LAB_SOURCE_CHANGED');
  // Keep the raw capture untouched as evidence. Only the processing copy is
  // writable; deliberately omit SHM so SQLite rebuilds its disposable WAL index.
  await mkdir(processing);
  for (const suffix of ['', '-wal']) {
    const path = join(capture, 'edge.db' + suffix);
    if (await exists(path)) await copyFile(path, join(processing, 'edge.db' + suffix));
  }
  const source = new Database(join(processing, 'edge.db'), { fileMustExist: true });
  source.pragma('query_only=ON');
  try {
    checkIntegrity(source);
    if (inspectRecoveryUpgradeSchema(source) !== 13) throw new Error('UPGRADE_LAB_SOURCE_NOT_1U');
    const binding = identity(source);
    const sourceCredentials = createEdgeSecretStore({
      NODE_ENV: 'development',
      COMANVIEW_EDGE_SECRET_STORE: input.sourceStore,
      COMANVIEW_EDGE_SECRET_PATH: sourceSecret,
    });
    const secrets = await sourceCredentials.load();
    if (!secrets.active || secrets.active.credentialId !== binding.credentialId || secrets.pending)
      throw new Error('UPGRADE_LAB_SOURCE_CREDENTIAL_INVALID');
    const baselineHashes = hashTables(source);
    await mkdir(dirname(p.baseline));
    await mkdir(dirname(p.db));
    await source.backup(p.baseline);
    const baseline = readDb(p.baseline);
    try {
      checkIntegrity(baseline);
      if (inspectRecoveryUpgradeSchema(baseline) !== 13)
        throw new Error('UPGRADE_LAB_BASELINE_INVALID');
      equal(hashTables(baseline), baselineHashes, 'UPGRADE_LAB_SNAPSHOT_MISMATCH');
      await baseline.backup(p.db);
    } finally {
      baseline.close();
    }
    // Rewrap the SAME credential into the COPY. No provisioning, rotation or source save.
    const target = new WindowsDpapiEdgeSecretStore(p.secret);
    await target.save(secrets);
    equal(await target.load(), secrets, 'UPGRADE_LAB_CREDENTIAL_COPY_FAILED');
    equal(hashTables(source), baselineHashes, 'UPGRADE_LAB_SOURCE_CHANGED');
    equal(await originalHashes(sourceDb, sourceSecret), sourceHashes, 'UPGRADE_LAB_SOURCE_CHANGED');
    if ((await exists(p.floor)) || (await exists(p.safety)))
      throw new Error('UPGRADE_LAB_ALREADY_UPGRADED');
    const runtime = readDb(p.db);
    try {
      if (inspectRecoveryUpgradeSchema(runtime) !== 13)
        throw new Error('UPGRADE_LAB_RUNTIME_NOT_1U');
      equal(hashTables(runtime), baselineHashes, 'UPGRADE_LAB_RUNTIME_CHANGED');
    } finally {
      runtime.close();
    }
    const marker: Marker = {
      version: 1,
      sourceDb,
      sourceSecret,
      sourceStore: input.sourceStore,
      sourceHashes,
      binding,
      publicKey,
      kid: input.kid,
      baselineHashes,
    };
    await writeFile(p.ready, JSON.stringify(marker, null, 2), { flag: 'wx', mode: 0o600 });
  } finally {
    source.close();
  }
  return inspectUpgradeLab(input.acceptanceRoot, input.labRoot);
}

export async function inspectUpgradeLab(acceptanceRoot: string, labRoot: string) {
  const p = upgradeLabPaths(acceptanceRoot, labRoot),
    m = await marker(p);
  equal(
    await originalHashes(m.sourceDb, m.sourceSecret),
    m.sourceHashes,
    'UPGRADE_LAB_SOURCE_CHANGED',
  );
  const base = readDb(p.baseline),
    db = readDb(p.db);
  try {
    checkIntegrity(base);
    checkIntegrity(db);
    if (inspectRecoveryUpgradeSchema(base) !== 13) throw new Error('UPGRADE_LAB_BASELINE_NOT_1U');
    equal(hashTables(base), m.baselineHashes, 'UPGRADE_LAB_BASELINE_CHANGED');
    const schema = inspectRecoveryUpgradeSchema(db);
    equal(identity(db), m.binding, 'UPGRADE_LAB_BINDING_CHANGED');
    const data = hashTables(db, base);
    for (const table of unchangedTables)
      equal(
        data[table],
        m.baselineHashes[table],
        `UPGRADE_LAB_DATA_CHANGED_${table.toUpperCase()}`,
      );
    const credential = await new WindowsDpapiEdgeSecretStore(p.secret).load();
    if (!credential.active || credential.active.credentialId !== m.binding.credentialId)
      throw new Error('UPGRADE_LAB_CREDENTIAL_INVALID');
    if (schema === 13) {
      if (
        (await exists(p.floor)) ||
        (await exists(p.safety)) ||
        (await exists(join(p.root, FIRST)))
      )
        throw new Error('UPGRADE_LAB_PARTIAL_TRANSITION');
      equal(data, m.baselineHashes, 'UPGRADE_LAB_RUNTIME_CHANGED');
      return {
        LAB_READY: true,
        ISOLATED_RUNTIME: true,
        RUNTIME_DB: p.db,
        SOURCE_UNCHANGED: true,
        BASELINE_SCHEMA: 13,
        RUNTIME_SCHEMA: 13,
        SECURITY_FLOOR_PRESENT: false,
        DATA_PRESERVED: true,
        UPGRADE_COMPLETED: false,
      };
    }
    const floor = await readFloor(p.floor);
    const { credentialId: ignored, ...binding } = m.binding;
    void ignored;
    if (
      !floor.installationEstablished ||
      floor.recoveryState !== 'NORMAL' ||
      floor.upgradeJournal ||
      floor.journal ||
      floor.minimumSchemaVersion !== 14 ||
      floor.recoveryEpoch !== 0 ||
      !floor.recoveryKey
    )
      throw new Error('UPGRADE_LAB_FLOOR_INVALID');
    equal(floor.binding, binding, 'UPGRADE_LAB_FLOOR_BINDING_INVALID');
    const merged = mergeRecoverySecurityMetadata(floor, base);
    equal(
      merged.maximumSignedRevisions,
      floor.maximumSignedRevisions,
      'UPGRADE_LAB_LICENSING_REDUCED',
    );
    equal(merged.stickyDeclaredState, floor.stickyDeclaredState, 'UPGRADE_LAB_LICENSING_REDUCED');
    equal(merged.revokedDeviceBloom, floor.revokedDeviceBloom, 'UPGRADE_LAB_REVOCATIONS_REDUCED');
    for (const row of base.prepare("SELECT id FROM devices WHERE status='REVOKED'").all() as Array<{
      id: string;
    }>) {
      if (
        !isDeviceRevokedByFloor(floor, row.id) ||
        !db.prepare("SELECT 1 FROM devices WHERE id=? AND status='REVOKED'").get(row.id)
      )
        throw new Error('UPGRADE_LAB_DEVICE_REVIVED');
    }
    if (
      db.prepare('SELECT 1 FROM event_log WHERE recovery_epoch<>0 LIMIT 1').get() ||
      (
        db
          .prepare(
            "SELECT recovery_epoch epoch FROM edge_installations WHERE singleton_key='PRIMARY'",
          )
          .get() as { epoch: number }
      ).epoch !== 0
    )
      throw new Error('UPGRADE_LAB_EPOCH_CHANGED');
    await safetyEvidence(p);
    return {
      LAB_READY: true,
      ISOLATED_RUNTIME: true,
      RUNTIME_DB: p.db,
      SOURCE_UNCHANGED: true,
      BASELINE_SCHEMA: 13,
      RUNTIME_SCHEMA: 14,
      SECURITY_FLOOR_PRESENT: true,
      SECURITY_FLOOR_VALID: true,
      DATA_PRESERVED: true,
      RECOVERY_EPOCH: 0,
      RECOVERY_STATE: 'NORMAL',
      UPGRADE_COMPLETED: true,
    };
  } finally {
    base.close();
    db.close();
  }
}

/** Records evidence only; SQLite, credentials and floor are strictly read-only. */
export async function recordUpgradeStart(
  acceptanceRoot: string,
  labRoot: string,
  startId: string,
  restart = false,
) {
  const report = await inspectUpgradeLab(acceptanceRoot, labRoot);
  if (!report.UPGRADE_COMPLETED) throw new Error('UPGRADE_LAB_NOT_UPGRADED');
  const p = upgradeLabPaths(acceptanceRoot, labRoot),
    floor = await readFloor(p.floor);
  const proof = {
    schema: 14,
    epoch: floor.recoveryEpoch,
    binding: floor.binding,
    securityDigest: digest({
      key: floor.recoveryKey,
      revocations: floor.revokedDeviceBloom,
      revisions: floor.maximumSignedRevisions,
      sticky: floor.stickyDeclaredState,
      minimumSchemaVersion: floor.minimumSchemaVersion,
    }),
    safety: await safetyEvidence(p),
  };
  const path = join(p.root, FIRST);
  if (restart) {
    const first = JSON.parse(await readFile(path, 'utf8')) as { startId: string; proof: unknown };
    if (first.startId === startId) throw new Error('UPGRADE_LAB_SECOND_START_REQUIRED');
    equal(first.proof, proof, 'UPGRADE_LAB_NOT_IDEMPOTENT');
    return { ...report, RESTART_IDEMPOTENT: true };
  }
  await writeFile(path, JSON.stringify({ startId, proof }, null, 2), { flag: 'wx', mode: 0o600 });
  return { ...report, FIRST_START_VERIFIED: true };
}

export async function upgradeLabEnvironment(
  acceptanceRoot: string,
  labRoot: string,
  host: NodeJS.ProcessEnv = process.env,
) {
  const p = upgradeLabPaths(acceptanceRoot, labRoot),
    m = await marker(p);
  await inspectUpgradeLab(acceptanceRoot, labRoot);
  // No inherited DB/token/bootstrap/Cloud/Node preload settings. Keep only OS necessities.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(host))
    if (
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|SYSTEMDRIVE)$/i.test(
        key,
      )
    )
      env[key] = value;
  const temporary = join(p.root, 'temporary');
  await mkdir(temporary, { recursive: true });
  return {
    ...env,
    NODE_ENV: 'production',
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    COMANVIEW_EDGE_DB_PATH: p.db,
    COMANVIEW_EDGE_SECRET_STORE: 'windows-dpapi',
    COMANVIEW_EDGE_SECRET_PATH: p.secret,
    COMANVIEW_RECOVERY_SECURITY_STORE: 'windows-dpapi',
    COMANVIEW_RECOVERY_SECURITY_PATH: p.floor,
    COMANVIEW_BACKUP_LOCAL_DIR: p.backups,
    COMANVIEW_SYNC_ENABLED: 'false',
    COMANVIEW_LICENSE_ENFORCEMENT_ENABLED: 'true',
    COMANVIEW_LICENSE_PUBLIC_KEYRING: JSON.stringify({ [m.kid]: m.publicKey }),
    COMANVIEW_EDGE_SCHEMA_VERSION: '14',
  };
}

class InspectionDpapi extends WindowsDpapiRecoverySecurityStore {
  async inspect() {
    return JSON.parse(
      (await this.decode(await readFile(this.path))).toString('utf8'),
    ) as RecoverySecurityFloor;
  }
}
async function readFloor(path: string) {
  // DO NOT use product load(): its corruption handler writes a recovery marker.
  const floor = await new InspectionDpapi(path).inspect();
  const { checksum, ...body } = floor;
  if (
    floor.formatVersion !== 1 ||
    checksum !== digest(body) ||
    typeof floor.recoveryKey !== 'string' ||
    Buffer.from(floor.recoveryKey, 'base64url').length !== 32
  )
    throw new Error('UPGRADE_LAB_FLOOR_INVALID');
  return floor;
}
async function marker(p: Paths): Promise<Marker> {
  await noLinks(p.root);
  await noLinks(p.baseline);
  await noLinks(p.db);
  await noLinks(p.secret);
  await noLinks(p.floor);
  for (const path of [
    p.ready,
    p.backups,
    p.safety,
    join(p.root, 'temporary'),
    join(p.root, FIRST),
    join(p.root, '.running.json'),
  ])
    await noLinks(path);
  const m = JSON.parse(await readFile(p.ready, 'utf8')) as Marker;
  if (
    m.version !== 1 ||
    !m.sourceDb ||
    !m.sourceSecret ||
    inside(m.sourceDb, p.parent) ||
    inside(m.sourceSecret, p.parent) ||
    !m.publicKey ||
    !m.kid ||
    !m.binding ||
    !m.baselineHashes ||
    !m.sourceHashes
  )
    throw new Error('UPGRADE_LAB_MARKER_INVALID');
  return m;
}
function readDb(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only=ON');
  return db;
}
function checkIntegrity(db: Database.Database) {
  equal(db.pragma('integrity_check'), [{ integrity_check: 'ok' }], 'UPGRADE_LAB_SQLITE_INVALID');
  equal(db.pragma('foreign_key_check'), [], 'UPGRADE_LAB_SQLITE_INVALID');
}
function identity(db: Database.Database): Binding {
  const rows = db
    .prepare(
      `SELECT tenant_id tenantId,location_id locationId,edge_id edgeId,credential_id credentialId,
    provisioning_state state FROM edge_installations`,
    )
    .all() as Array<Binding & { state: string }>;
  if (rows.length !== 1 || rows[0]?.state !== 'ACTIVE' || !rows[0]?.credentialId)
    throw new Error('UPGRADE_LAB_SOURCE_NOT_ESTABLISHED');
  const { state: ignored, ...binding } = rows[0];
  void ignored;
  return binding;
}
function hashTables(db: Database.Database, reference = db) {
  const result: Record<string, Digest> = {};
  for (const { name } of reference
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>) {
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const columns = (reference.pragma(`table_info(${quote(name)})`) as Array<{ name: string }>)
      .map((c) => quote(c.name))
      .join(',');
    const hash = createHash('sha256');
    let rows = 0;
    for (const row of db
      .prepare(`SELECT ${columns} FROM ${quote(name)} ORDER BY rowid`)
      .safeIntegers()
      .iterate()) {
      hash.update(
        JSON.stringify(row, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ) + '\n',
      );
      rows++;
    }
    result[name] = { rows, sha256: hash.digest('hex') };
  }
  return result;
}
async function safetyEvidence(p: Paths) {
  await noLinks(p.safety);
  const artifacts = (await readdir(p.safety)).sort();
  if (artifacts.length !== 1 || !artifacts[0]?.endsWith('.cvbackup'))
    throw new Error('UPGRADE_LAB_SAFETY_SNAPSHOT_INVALID');
  const path = join(p.safety, artifacts[0]);
  await noLinks(path);
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as {
    schemaVersion: number;
    trigger: string;
    ciphertextSha256: string;
  };
  if (
    manifest.schemaVersion !== 13 ||
    manifest.trigger !== 'SAFETY' ||
    manifest.ciphertextSha256 !== (await fileHash(join(path, 'database.enc')))
  )
    throw new Error('UPGRADE_LAB_SAFETY_SNAPSHOT_INVALID');
  return {
    artifact: artifacts[0],
    manifest: await fileHash(join(path, 'manifest.json')),
    payload: manifest.ciphertextSha256,
  };
}
async function originalHashes(db: string, secret: string) {
  return {
    database: await fileHash(db),
    wal: (await exists(`${db}-wal`)) ? await fileHash(`${db}-wal`) : null,
    shm: (await exists(`${db}-shm`)) ? await fileHash(`${db}-shm`) : null,
    journal: (await exists(`${db}-journal`)) ? await fileHash(`${db}-journal`) : null,
    secret: await fileHash(secret),
  };
}
async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes as Buffer);
  return hash.digest('hex');
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function equal(a: unknown, b: unknown, code: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(code);
}
async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    });
}
function same(a: string, b: string) {
  return process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
}
function inside(path: string, root: string) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function noLinks(path: string): Promise<void> {
  const full = resolve(path),
    parent = dirname(full);
  if (parent !== full) await noLinks(parent);
  const info = await lstat(full).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (info && (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)))
    throw new Error('UPGRADE_LAB_LINK_NOT_ALLOWED');
}
