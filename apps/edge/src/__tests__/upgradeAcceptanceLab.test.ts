import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  inspectUpgradeLab,
  prepareUpgradeLab,
  recordUpgradeStart,
  upgradeLabEnvironment,
  upgradeLabPaths,
} from '../upgradeAcceptanceLab.js';
import { prepareProductionRecoveryUpgrade } from '../modules/backup/ProductionRecoveryUpgrade.js';
import { WindowsDpapiEdgeSecretStore } from '../modules/provisioning/EdgeSecretStore.js';
import { WindowsDpapiRecoverySecurityStore } from '../modules/backup/RecoverySecurityStore.js';
import { inspectRecoveryUpgradeSchema, applyRecoveryUpgradeMigration } from '@comanview/database';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const migrations = fileURLToPath(new URL('../../../../migrations/edge/', import.meta.url));
const tenant = '01991a00-0000-7000-8000-000000000701',
  location = '01991a00-0000-7000-8000-000000000702',
  edge = '01991a00-0000-7000-8000-000000000703';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cv-upgrade-harness-'));
  roots.push(root);
  const source = join(root, 'original.db'),
    secret = join(root, 'original-secret.json'),
    settingsPath = join(root, 'settings.json');
  const publicKeyPath = join(root, 'public.pem'),
    acceptanceRoot = join(root, 'ComanView', 'RecoveryAcceptance'),
    labRoot = join(acceptanceRoot, 'phase-1v-upgrade');
  const db = new Database(source);
  try {
    for (const name of readdirSync(migrations)
      .filter((n) => /^\d{4}_/.test(n) && Number(n.slice(0, 4)) <= 13)
      .sort())
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    db.prepare(
      `INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,credential_id)
      VALUES('PRIMARY',?,?,?,1,'credential')`,
    ).run(edge, tenant, location);
    db.exec(`INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,created_at)
      VALUES('order','${tenant}','${location}','DINE_IN','POS','1','MXN','OPEN',1);
      INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,created_at) VALUES('register','${tenant}','${location}','Caja','MXN',1);
      INSERT INTO cash_sessions(id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,opened_at,opened_by,open_command_id)
      VALUES('cash','register','${tenant}','${location}',1000,'MXN','2026-09-02','OPEN',1,'owner','open');
      INSERT INTO payments(id,order_id,cash_session_id,method,amount_applied_amount,tip_amount,currency,change_given_amount,status,command_id,created_at)
      VALUES('payment','order','cash','CASH',500,0,'MXN',0,'COMPLETED','pay',1);
      INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,payload,occurred_at,local_sequence) VALUES('event','ORDER_CREATED','ORDER','order','{}',1,9);
      INSERT INTO audit_log(audit_id,occurred_at,tenant_id,location_id,action,entity_type,entity_id,outcome,reason,entry_hash)
      VALUES('audit',1,'${tenant}','${location}','ORDER_CREATED','ORDER','order','SUCCESS','fixture','hash');`);
  } finally {
    db.close();
  }
  await writeFile(
    secret,
    JSON.stringify({
      active: { credentialId: 'credential', credential: 'fixture-secret-'.repeat(4) },
      pending: null,
    }),
  );
  await writeFile(
    settingsPath,
    JSON.stringify({ edgeDatabasePath: source, edgeSecretPath: secret }),
  );
  await writeFile(
    publicKeyPath,
    generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
  );
  await mkdir(join(acceptanceRoot, 'phase-1v'), { recursive: true });
  await writeFile(join(acceptanceRoot, 'phase-1v', 'keep.txt'), 'previous accepted lab');
  return {
    root,
    source,
    secret,
    settingsPath,
    publicKeyPath,
    acceptanceRoot,
    labRoot,
    kid: 'fixture',
    sourceStore: 'development-file' as const,
  };
}
function withDb(path: string, fn: (db: Database.Database) => void) {
  const db = new Database(path, { fileMustExist: true });
  try {
    fn(db);
  } finally {
    db.close();
  }
}
describe.skipIf(process.platform !== 'win32')('isolated manual upgrade acceptance harness', () => {
  it('starts genuinely at 1U, preserves source/old lab, and verifies upgrade then a distinct restart read-only', async () => {
    const f = await fixture(),
      sourceBefore = await readFile(f.source),
      secretBefore = await readFile(f.secret);
    expect(await prepareUpgradeLab(f)).toMatchObject({
      RUNTIME_SCHEMA: 13,
      BASELINE_SCHEMA: 13,
      SECURITY_FLOOR_PRESENT: false,
      UPGRADE_COMPLETED: false,
    });
    const p = upgradeLabPaths(f.acceptanceRoot, f.labRoot);
    const status = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        fileURLToPath(new URL('../../../../scripts/Phase1V-UpgradeLab.ps1', import.meta.url)),
        '-Action',
        'Status',
      ],
      { env: { ...process.env, LOCALAPPDATA: f.root }, windowsHide: true },
    );
    expect(status.stdout).toContain('RUNTIME_SCHEMA = 13');
    expect(status.stdout).toContain('SECURITY_FLOOR_PRESENT = false');
    withDb(p.db, (db) => expect(inspectRecoveryUpgradeSchema(db)).toBe(13));
    expect(await readdir(join(f.labRoot, 'runtime'))).not.toContain('security-floor.bin');
    expect(await readFile(f.source)).toEqual(sourceBefore);
    expect(await readFile(f.secret)).toEqual(secretBefore);
    await expect(readFile(`${f.source}-wal`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${f.source}-shm`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.acceptanceRoot, 'phase-1v', 'keep.txt'), 'utf8')).toBe(
      'previous accepted lab',
    );
    expect((await readFile(p.secret)).toString()).not.toContain('fixture-secret');
    const env = await upgradeLabEnvironment(f.acceptanceRoot, f.labRoot, {
      NODE_ENV: 'development',
      COMANVIEW_EDGE_DB_PATH: f.source,
      COMANVIEW_CLOUD_URL: 'https://must-not-connect.example',
      COMANVIEW_EDGE_SYNC_TOKEN: 'secret',
      NODE_OPTIONS: '--bad',
      PATH: process.env['PATH'],
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      COMANVIEW_SYNC_ENABLED: 'false',
      COMANVIEW_EDGE_DB_PATH: p.db,
      COMANVIEW_EDGE_SECRET_STORE: 'windows-dpapi',
      COMANVIEW_RECOVERY_SECURITY_STORE: 'windows-dpapi',
    });
    expect(env).not.toHaveProperty('COMANVIEW_CLOUD_URL');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('COMANVIEW_EDGE_SYNC_TOKEN');
    expect(env.COMANVIEW_EDGE_SECRET_PATH).toBe(p.secret);
    const store = new WindowsDpapiRecoverySecurityStore(p.floor),
      edgeSecretStore = new WindowsDpapiEdgeSecretStore(p.secret);
    expect(
      await prepareProductionRecoveryUpgrade({ dbPath: p.db, store, edgeSecretStore }),
    ).toEqual({ state: 'UPGRADED' });
    const floorBefore = await readFile(p.floor),
      runtimeBefore = await readFile(p.db);
    expect(await recordUpgradeStart(f.acceptanceRoot, f.labRoot, 'start-1')).toMatchObject({
      FIRST_START_VERIFIED: true,
    });
    await expect(recordUpgradeStart(f.acceptanceRoot, f.labRoot, 'start-1', true)).rejects.toThrow(
      'SECOND_START_REQUIRED',
    );
    expect(
      await prepareProductionRecoveryUpgrade({ dbPath: p.db, store, edgeSecretStore }),
    ).toEqual({ state: 'CURRENT' });
    expect(await recordUpgradeStart(f.acceptanceRoot, f.labRoot, 'start-2', true)).toMatchObject({
      RESTART_IDEMPOTENT: true,
    });
    expect(await readFile(p.floor)).toEqual(floorBefore);
    expect(await readFile(p.db)).toEqual(runtimeBefore);
    expect(await readFile(f.source)).toEqual(sourceBefore);
    expect(await readFile(f.secret)).toEqual(secretBefore);
    withDb(p.db, (db) => db.exec('UPDATE payments SET amount_applied_amount=999'));
    await expect(inspectUpgradeLab(f.acceptanceRoot, f.labRoot)).rejects.toThrow(
      'DATA_CHANGED_PAYMENTS',
    );
  }, 60_000);
  it('refuses to overwrite an existing lab and leaves the previous recovery lab intact', async () => {
    const f = await fixture();
    await mkdir(f.labRoot);
    await writeFile(join(f.labRoot, 'keep'), 'do not overwrite');
    await expect(prepareUpgradeLab(f)).rejects.toThrow('ALREADY_EXISTS');
    expect(await readFile(join(f.labRoot, 'keep'), 'utf8')).toBe('do not overwrite');
    expect(await readFile(join(f.acceptanceRoot, 'phase-1v', 'keep.txt'), 'utf8')).toBe(
      'previous accepted lab',
    );
  });
  it('refuses a source already migrated to 1V, without publishing a ready lab', async () => {
    const f = await fixture();
    withDb(f.source, (db) => applyRecoveryUpgradeMigration(db));
    await expect(prepareUpgradeLab(f)).rejects.toThrow('SOURCE_NOT_1U');
    await expect(readFile(join(f.labRoot, '.upgrade-lab.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('refuses a source with live WAL instead of racing an active SQLite client', async () => {
    const f = await fixture(),
      db = new Database(f.source);
    try {
      db.exec('UPDATE payments SET amount_applied_amount=501');
      const before = await sourceBytes(f.source);
      await expect(prepareUpgradeLab(f)).rejects.toThrow('SOURCE_IN_USE');
      expect(await sourceBytes(f.source)).toEqual(before);
      await expect(readFile(join(f.labRoot, '.upgrade-lab.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      db.close();
    }
  });
  it.each([false, true])(
    'captures committed WAL after abrupt exit, with missing SHM=%s',
    async (missingShm) => {
      const f = await fixture();
      // A real SQLite writer exits without close/checkpoint, like an interrupted
      // application. Commit 501 only into WAL, then leave an uncommitted change.
      await promisify(execFile)(
        process.execPath,
        [
          '-e',
          `
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1]);
      db.pragma('journal_mode=WAL');
      db.pragma('wal_autocheckpoint=0');
      db.exec('UPDATE payments SET amount_applied_amount=501');
      db.pragma('cache_size=1');
      db.exec('BEGIN IMMEDIATE; UPDATE payments SET amount_applied_amount=999;');
      db.prepare('UPDATE audit_log SET reason=?').run('uncommitted'.repeat(10000));
      process.exit(0);
    `,
          f.source,
        ],
        { windowsHide: true },
      );
      if (missingShm) await rm(`${f.source}-shm`); // synthetic fixture only
      const before = await sourceBytes(f.source);
      expect(before[1]!.length).toBeGreaterThan(32);
      expect(await prepareUpgradeLab(f)).toMatchObject({
        SOURCE_UNCHANGED: true,
        RUNTIME_SCHEMA: 13,
        BASELINE_SCHEMA: 13,
        SECURITY_FLOOR_PRESENT: false,
        UPGRADE_COMPLETED: false,
      });
      expect(await sourceBytes(f.source)).toEqual(before);
      const p = upgradeLabPaths(f.acceptanceRoot, f.labRoot);
      for (const path of [p.baseline, p.db])
        withDb(path, (db) => {
          expect(inspectRecoveryUpgradeSchema(db)).toBe(13);
          expect(db.prepare('SELECT amount_applied_amount amount FROM payments').get()).toEqual({
            amount: 501,
          });
          expect(db.prepare('SELECT reason FROM audit_log').get()).toEqual({ reason: 'fixture' });
        });
      expect(await readFile(join(f.labRoot, 'capture', 'edge.db'))).toEqual(before[0]);
      expect(await readFile(join(f.labRoot, 'capture', 'edge.db-wal'))).toEqual(before[1]);
      // Prove the committed value was NOT present in the main file: examine only
      // a disposable test copy of the captured main file, never the original.
      const mainOnly = join(f.root, 'main-only.db');
      await writeFile(mainOnly, before[0]!);
      withDb(mainOnly, (db) =>
        expect(db.prepare('SELECT amount_applied_amount amount FROM payments').get()).toEqual({
          amount: 500,
        }),
      );
      expect(await sourceBytes(f.source)).toEqual(before);
      expect(await readFile(join(f.acceptanceRoot, 'phase-1v', 'keep.txt'), 'utf8')).toBe(
        'previous accepted lab',
      );
      // SOURCE_UNCHANGED includes SHM bytes/presence, not only DB and WAL.
      await writeFile(`${f.source}-shm`, 'changed fixture SHM');
      await expect(inspectUpgradeLab(f.acceptanceRoot, f.labRoot)).rejects.toThrow(
        'SOURCE_CHANGED',
      );
    },
    30_000,
  );
  it('fails closed on an unsupported rollback journal, preserving evidence and source', async () => {
    const f = await fixture();
    await writeFile(`${f.source}-journal`, 'synthetic unsupported journal');
    const before = await sourceBytes(f.source);
    await expect(prepareUpgradeLab(f)).rejects.toThrow('SOURCE_ROLLBACK_JOURNAL');
    expect(await sourceBytes(f.source)).toEqual(before);
    await expect(readFile(join(f.labRoot, '.upgrade-lab.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('refuses a missing source or a credential mismatch without publishing a ready lab', async () => {
    const f = await fixture();
    await writeFile(
      f.secret,
      JSON.stringify({
        active: { credentialId: 'other', credential: 'x'.repeat(40) },
        pending: null,
      }),
    );
    await expect(prepareUpgradeLab(f)).rejects.toThrow('SOURCE_CREDENTIAL_INVALID');
    await writeFile(
      f.settingsPath,
      JSON.stringify({ edgeDatabasePath: join(f.root, 'missing.db'), edgeSecretPath: f.secret }),
    );
    await expect(prepareUpgradeLab(f)).rejects.toThrow();
    await expect(readFile(join(f.labRoot, '.upgrade-lab.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('does not repair, rename or overwrite an invalid floor during inspection', async () => {
    const f = await fixture();
    await prepareUpgradeLab(f);
    const p = upgradeLabPaths(f.acceptanceRoot, f.labRoot);
    withDb(p.db, (db) => applyRecoveryUpgradeMigration(db));
    await writeFile(p.floor, 'invalid floor');
    const files = (await readdir(dirnamePath(p.floor))).filter((name) =>
      name.startsWith('security-floor'),
    );
    const dbBefore = await readFile(p.db);
    await expect(inspectUpgradeLab(f.acceptanceRoot, f.labRoot)).rejects.toThrow();
    expect(await readFile(p.floor, 'utf8')).toBe('invalid floor');
    expect(
      (await readdir(dirnamePath(p.floor))).filter((name) => name.startsWith('security-floor')),
    ).toEqual(files);
    expect(await readFile(p.db)).toEqual(dbBefore);
  }, 20_000);
  it('rejects lab paths outside the dedicated namespace', async () => {
    const f = await fixture();
    expect(() => upgradeLabPaths(f.acceptanceRoot, join(f.acceptanceRoot, 'phase-1v'))).toThrow(
      'UNSAFE_PATH',
    );
    expect(() => upgradeLabPaths(f.acceptanceRoot, join(f.root, 'phase-1v-upgrade'))).toThrow(
      'UNSAFE_PATH',
    );
  });
});
function dirnamePath(path: string) {
  return join(path, '..');
}
async function sourceBytes(path: string) {
  return Promise.all(
    ['', '-wal', '-shm', '-journal'].map((suffix) =>
      readFile(path + suffix).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      }),
    ),
  );
}
