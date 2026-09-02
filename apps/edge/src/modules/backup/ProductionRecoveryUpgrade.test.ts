import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';
import { signRecoveryAuthorization } from '@comanview/licensing';
import { EntityId } from '@comanview/domain';
import {
  createEdgeDatabase,
  BackupRepository,
  SyncOutboxRepository,
  inspectRecoveryUpgradeSchema,
  applyRecoveryUpgradeMigration,
} from '@comanview/database';
import { prepareProductionRecoveryUpgrade } from './ProductionRecoveryUpgrade.js';
import {
  DevelopmentRecoverySecurityStore,
  createRecoverySecurityStore,
  addRevokedDevice,
  ensureRecoveryKey,
  isDeviceRevokedByFloor,
  updateRecoverySecurityFloor,
  type RecoverySecurityStore,
} from './RecoverySecurityStore.js';
import { DevelopmentFileEdgeSecretStore } from '../provisioning/EdgeSecretStore.js';
import { assessStartupDatabase } from './StartupRecoveryGuard.js';
import * as artifacts from './BackupArtifact.js';
import { buildApp } from '../../index.js';
import { closeDatabase } from '../../infrastructure/database.js';
import {
  completePendingRecoveryAtStartup,
  scheduleEmergencyRecovery,
} from './RecoveryCoordinator.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  closeDatabase();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('hardware replacement through the complete 1V startup lifecycle', () => {
  it.each(['normal', 'post-sqlite', 'post-floor', 'post-final'] as const)(
    'persists the restored security floor before normal startup (%s)',
    async (stage) => {
      const source = await fixture(),
        target = await fixture();
      const targetBinding = { ...binding, edgeId: '01991a00-0000-7000-8000-000000000799' };
      inspect(source.dbPath, (db) => {
        db.prepare(
          `INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at)
          VALUES('user',?,?,'Fixture','ACTIVE','hash',1)`,
        ).run(binding.tenantId, binding.locationId);
        db.prepare(
          `INSERT INTO auth_sessions(id,user_id,device_id,tenant_id,location_id,token_hash,login_at,last_activity,expires_at)
          VALUES('session','user',?,?,?,'fixture-token-hash',1,1,9999999999999)`,
        ).run(activeId, binding.tenantId, binding.locationId);
      });
      inspect(target.dbPath, (db) =>
        db.prepare('UPDATE edge_installations SET edge_id=?').run(targetBinding.edgeId),
      );
      expect(await prepareProductionRecoveryUpgrade(source)).toEqual({ state: 'UPGRADED' });
      expect(await prepareProductionRecoveryUpgrade(target)).toEqual({ state: 'UPGRADED' });
      const targetBefore = await target.store.load(),
        sourceFloor = await source.store.load();
      expect(isDeviceRevokedByFloor(targetBefore, activeId)).toBe(false);
      const sourceBefore = await readFile(source.dbPath),
        secretBefore = await target.edgeSecretStore.load();
      const backupId = EntityId.generate().toString(),
        authorizationId = EntityId.generate().toString(),
        now = new Date();
      const sourceDb = new Database(source.dbPath, { readonly: true, fileMustExist: true });
      let artifact: Awaited<ReturnType<typeof artifacts.createEncryptedBackupArtifact>>;
      try {
        artifact = await artifacts.createEncryptedBackupArtifact({
          source: sourceDb,
          destinationDirectory: join(source.root, 'external'),
          backupId,
          binding: { ...binding, recoveryEpoch: 0 },
          recoveryKey: sourceFloor.recoveryKey!,
          trigger: 'MANUAL',
          destinationType: 'OFF_DEVICE',
          businessDate: null,
        });
      } finally {
        sourceDb.close();
      }
      const keys = generateKeyPairSync('ed25519');
      const publicKeyring = {
        fixture: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      };
      const recoveryAuthorization = signRecoveryAuthorization(
        {
          formatVersion: 1,
          typ: 'comanview-recovery-authorization',
          authorizationId,
          tenantId: binding.tenantId,
          locationId: binding.locationId,
          sourceEdgeId: binding.edgeId,
          targetEdgeId: targetBinding.edgeId,
          backupId,
          recoveryEpoch: 1,
          purpose: 'HARDWARE_REPLACEMENT_RESTORE',
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 1800000).toISOString(),
          nonce: EntityId.generate().toString(),
        },
        'fixture',
        keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      );
      const request = {
        commandId: EntityId.generate().toString(),
        backupId,
        artifactPath: artifact.artifactPath,
        recoveryKey: sourceFloor.recoveryKey!,
        recoveryAuthorization,
        binding: targetBinding,
        publicKeyring,
        securityStore: target.store,
        dbPath: target.dbPath,
        now,
      };
      await scheduleEmergencyRecovery(request);
      let interrupted = false,
        normalWasChecked = false;
      const injected: RecoverySecurityStore = {
        load: () => target.store.load(),
        mutate: async (change) => {
          const next = await target.store.mutate((current) => {
            const value = change(current);
            if (
              stage === 'post-sqlite' &&
              !interrupted &&
              current.journal &&
              isDeviceRevokedByFloor(value, activeId)
            ) {
              interrupted = true;
              throw new Error('simulated post-SQLite interruption');
            }
            return value;
          });
          if (
            stage === 'post-floor' &&
            !interrupted &&
            next.journal &&
            isDeviceRevokedByFloor(next, activeId)
          ) {
            interrupted = true;
            throw new Error('simulated post-floor interruption');
          }
          return next;
        },
        save: async (value) => {
          if (value.recoveryState === 'NORMAL' && !value.journal) {
            expect(isDeviceRevokedByFloor(value, activeId)).toBe(true);
            expect(isDeviceRevokedByFloor(await target.store.load(), activeId)).toBe(true);
            normalWasChecked = true;
          }
          await target.store.save(value);
          if (
            stage === 'post-final' &&
            !interrupted &&
            value.recoveryState === 'NORMAL' &&
            !value.journal
          ) {
            interrupted = true;
            throw new Error('simulated post-final interruption');
          }
        },
      };
      const first = await completePendingRecoveryAtStartup({
        dbPath: target.dbPath,
        store: injected,
      });
      if (stage === 'normal') {
        expect(first).toBe('COMPLETED');
        expect(normalWasChecked).toBe(true);
      } else {
        expect(interrupted).toBe(true);
        expect(first).toBe('RECOVERY_REQUIRED');
        if (stage !== 'post-final') {
          expect((await target.store.load()).journal).not.toBeNull();
          expect((await prepareProductionRecoveryUpgrade(target)).state).toBe('RECOVERY_REQUIRED');
        }
        expect(
          await completePendingRecoveryAtStartup({ dbPath: target.dbPath, store: target.store }),
        ).toBe(stage === 'post-final' ? 'NONE' : 'COMPLETED');
      }
      const floor = await target.store.load();
      expect(floor).toMatchObject({
        binding: targetBinding,
        recoveryEpoch: 1,
        recoveryState: 'NORMAL',
        journal: null,
        recoveryKey: targetBefore.recoveryKey,
        stickyDeclaredState: 'SUSPENDED',
        maximumSignedRevisions: { LICENSE: 4, FEATURE_FLAGS: 2, CONFIGURATION: 3 },
        pendingRecoveryAuthorizationAck: { authorizationId },
      });
      for (const id of [activeId, revokedId]) expect(isDeviceRevokedByFloor(floor, id)).toBe(true);
      inspect(target.dbPath, (db) => {
        expect(inspectRecoveryUpgradeSchema(db)).toBe(14);
        expect(db.prepare("SELECT count(*) n FROM devices WHERE status!='REVOKED'").get()).toEqual({
          n: 0,
        });
        expect(
          db.prepare('SELECT count(*) n FROM device_credentials WHERE revoked_at IS NULL').get(),
        ).toEqual({ n: 0 });
        expect(
          db.prepare('SELECT count(*) n FROM auth_sessions WHERE revoked_at IS NULL').get(),
        ).toEqual({ n: 0 });
        expect(db.prepare("SELECT recovery_epoch FROM event_log WHERE id='event'").get()).toEqual({
          recovery_epoch: 1,
        });
      });
      expect(await prepareProductionRecoveryUpgrade(target)).toEqual({ state: 'CURRENT' });
      expect(await assessStartupDatabase(target.dbPath, target.store, true, true)).toBe('NORMAL');
      const options = {
        recoverySecurityStore: target.store,
        edgeSecretStore: target.edgeSecretStore,
        enforceEstablishedInstallationSafety: true,
        startPrintWorker: false,
        startSyncWorker: false,
        startControlWorker: false,
        startBackupWorker: false,
      };
      for (let restart = 0; restart < 2; restart++) {
        const app = await buildApp(target.dbPath, options);
        try {
          expect((await app.inject('/health')).json()).toMatchObject({
            status: 'UP',
            database: { status: 'OK' },
          });
        } finally {
          await app.close();
        }
      }
      expect(
        await completePendingRecoveryAtStartup({ dbPath: target.dbPath, store: target.store }),
      ).toBe('NONE');
      await expect(scheduleEmergencyRecovery(request)).rejects.toMatchObject({
        code: 'RECOVERY_AUTHORIZATION_CONSUMED',
      });
      expect(await target.edgeSecretStore.load()).toEqual(secretBefore);
      expect(await readFile(source.dbPath)).toEqual(sourceBefore);
      expect(isDeviceRevokedByFloor(await target.store.load(), activeId)).toBe(true);
    },
    20_000,
  );
});
const migrationRoot = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
const binding = {
  tenantId: '01991a00-0000-7000-8000-000000000701',
  locationId: '01991a00-0000-7000-8000-000000000702',
  edgeId: '01991a00-0000-7000-8000-000000000703',
};
const revokedId = '01991a00-0000-7000-8000-000000000704',
  activeId = '01991a00-0000-7000-8000-000000000705';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cv-production-upgrade-'));
  roots.push(root);
  const dbPath = join(root, 'edge.db'),
    floorPath = join(root, 'floor.json');
  const store = new DevelopmentRecoverySecurityStore(floorPath),
    edgeSecretStore = new DevelopmentFileEdgeSecretStore(join(root, 'credential.json'));
  const db = new Database(dbPath);
  try {
    for (const file of readdirSync(migrationRoot)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 13)
      .sort())
      db.exec(readFileSync(join(migrationRoot, file), 'utf8'));
    db.pragma('foreign_keys=ON');
    db.prepare(
      `INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,credential_id,provisioning_state)
    VALUES('PRIMARY',?,?,?,1,'credential','ACTIVE')`,
    ).run(binding.edgeId, binding.tenantId, binding.locationId);
    db.exec(`UPDATE installation_state SET bootstrap_status='COMPLETED' WHERE singleton_key='PRIMARY';
    INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,created_at)
      VALUES('order','${binding.tenantId}','${binding.locationId}','DINE_IN','POS','A1','MXN','OPEN',1);
    INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,created_at) VALUES('register','${binding.tenantId}','${binding.locationId}','Caja','MXN',1);
    INSERT INTO cash_sessions(id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,opened_at,opened_by,open_command_id)
      VALUES('cash','register','${binding.tenantId}','${binding.locationId}',10000,'MXN','2026-09-02','OPEN',1,'owner','open-cash');
    INSERT INTO payments(id,order_id,cash_session_id,method,amount_applied_amount,tip_amount,currency,change_given_amount,status,command_id,created_at)
      VALUES('payment','order','cash','CASH',1500,100,'MXN',0,'COMPLETED','pay',1);
    INSERT INTO cash_movements(id,cash_session_id,movement_type,amount,currency,reason,actor_user_id,occurred_at,command_id)
      VALUES('movement','cash','CASH_IN',500,'MXN','fixture','owner',1,'movement-command');
    INSERT INTO cash_reports(id,cash_session_id,report_type,snapshot_json,generated_at,generated_by,command_id)
      VALUES('report','cash','X','{"amount":12000}',1,'owner','report-command');
    INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,payload,occurred_at,local_sequence)
      VALUES('event','ORDER_CREATED','ORDER','order','{"unchanged":true}',1,27);
    INSERT INTO audit_log(audit_id,occurred_at,tenant_id,location_id,action,entity_type,entity_id,outcome,reason,entry_hash)
      VALUES('audit',1,'${binding.tenantId}','${binding.locationId}','ORDER_CREATED','ORDER','order','SUCCESS','fixture','unchanged-hash');
    INSERT INTO devices(id,tenant_id,location_id,name,device_type,status,session_timeout_minutes,created_at,revoked_at)
      VALUES('${revokedId}','${binding.tenantId}','${binding.locationId}','Revoked','POS','REVOKED',60,1,2),
      ('${activeId}','${binding.tenantId}','${binding.locationId}','Active','POS','ACTIVE',60,1,NULL);
    INSERT INTO device_credentials(credential_id,device_id,credential_hash,created_at,revoked_at)
      VALUES('revoked-credential','${revokedId}','hash',1,2),('active-credential','${activeId}','hash2',1,NULL);
    UPDATE edge_control_runtime SET sticky_declared_state='SUSPENDED';`);
    for (const [type, revision] of [
      ['LICENSE', 4],
      ['FEATURE_FLAGS', 2],
      ['CONFIGURATION', 3],
    ] as const)
      db.prepare(
        `INSERT INTO edge_control_documents(document_id,document_type,revision,document_hash,envelope_json,payload_json,issued_at,received_at,is_current)
      VALUES(?,?,?,?, '{}','{}',1,1,0)`,
      ).run(type, type, revision, `hash-${type}`);
  } finally {
    db.close();
  }
  await edgeSecretStore.save({
    active: { credentialId: 'credential', credential: 'x'.repeat(40) },
    pending: null,
  });
  return { root, dbPath, floorPath, store, edgeSecretStore };
}
function inspect(path: string, fn: (db: Database.Database) => void) {
  const db = new Database(path, { fileMustExist: true });
  try {
    fn(db);
  } finally {
    db.close();
  }
}
function data(path: string) {
  let result: unknown;
  inspect(path, (db) => {
    result = Object.fromEntries(
      [
        'orders',
        'payments',
        'cash_sessions',
        'cash_movements',
        'cash_reports',
        'event_log',
        'audit_log',
      ].map((table) => [
        table,
        db
          .prepare(`SELECT * FROM ${table}`)
          .all()
          .map((row) => {
            const { recovery_epoch: ignored, ...rest } = row as Record<string, unknown>;
            void ignored;
            return rest;
          }),
      ]),
    );
  });
  return result;
}

describe('productive same-Edge 1U to 1V upgrade', () => {
  it('migrates real 1U SQL, preserves financial/history data and binding, seeds epoch/floor, and opens 1V repositories', async () => {
    const f = await fixture(),
      before = data(f.dbPath);
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
    expect(data(f.dbPath)).toEqual(before);
    const floor = await f.store.load();
    expect(floor).toMatchObject({
      installationEstablished: true,
      binding,
      recoveryEpoch: 0,
      recoveryState: 'NORMAL',
      upgradeJournal: null,
      maximumSignedRevisions: { LICENSE: 4, FEATURE_FLAGS: 2, CONFIGURATION: 3 },
      stickyDeclaredState: 'SUSPENDED',
    });
    expect(floor.recoveryKey).toHaveLength(43);
    expect(isDeviceRevokedByFloor(floor, revokedId)).toBe(true);
    inspect(f.dbPath, (db) => {
      expect(inspectRecoveryUpgradeSchema(db)).toBe(14);
      expect(db.prepare('SELECT recovery_epoch FROM event_log').get()).toEqual({
        recovery_epoch: 0,
      });
    });
    const handle = createEdgeDatabase(f.dbPath);
    try {
      expect(new SyncOutboxRepository(handle.db).findIdentity()).toMatchObject({
        ...binding,
        recoveryEpoch: 0,
      });
      expect(new BackupRepository(handle.db).runtime()?.workerStatus).toBe('IDLE');
      expect(new BackupRepository(handle.db).list()).toEqual([]);
    } finally {
      handle.close();
    }
    expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe('NORMAL');
    expect(await readdir(join(f.root, '.upgrade-1v'))).toHaveLength(1);
    const snapshot = join(f.root, '.upgrade-1v', (await readdir(join(f.root, '.upgrade-1v')))[0]!);
    expect(
      (await readFile(join(snapshot, 'database.enc'))).subarray(0, 16).toString(),
    ).not.toContain('SQLite format 3');
    await expect(
      artifacts.verifyEncryptedBackupArtifact({
        artifactPath: snapshot,
        recoveryKey: floor.recoveryKey!,
      }),
    ).rejects.toThrow('BACKUP_INCOMPATIBLE');
  });
  it('is idempotent and starts/restarts the actual app without a Cloud connection or dev preparation', async () => {
    const f = await fixture();
    const options = {
      recoverySecurityStore: f.store,
      edgeSecretStore: f.edgeSecretStore,
      enforceEstablishedInstallationSafety: true,
      startPrintWorker: false,
      startSyncWorker: false,
      startControlWorker: false,
      startBackupWorker: false,
    };
    let app = await buildApp(f.dbPath, options);
    try {
      expect((await app.inject('/health')).json()).toMatchObject({ status: 'UP' });
      expect((await f.store.load()).recoveryState).toBe('NORMAL');
    } finally {
      await app.close();
    }
    const before = await readdir(join(f.root, '.upgrade-1v'));
    expect(
      await prepareProductionRecoveryUpgrade({
        ...f,
        store: new DevelopmentRecoverySecurityStore(f.floorPath),
      }),
    ).toEqual({ state: 'CURRENT' });
    app = await buildApp(f.dbPath, options);
    try {
      expect((await app.inject('/health')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
    expect(await readdir(join(f.root, '.upgrade-1v'))).toEqual(before);
  });
  it('merges stronger external licensing and device revocations without regression', async () => {
    const f = await fixture();
    let floor = ensureRecoveryKey(await f.store.load()).floor;
    floor = addRevokedDevice(
      updateRecoverySecurityFloor(floor, {
        installationEstablished: true,
        binding,
        stickyDeclaredState: 'TERMINATED',
        maximumSignedRevisions: { LICENSE: 7, FEATURE_FLAGS: 6, CONFIGURATION: 5 },
      }),
      activeId,
    );
    const key = floor.recoveryKey;
    await f.store.save(floor);
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
    expect(await f.store.load()).toMatchObject({
      stickyDeclaredState: 'TERMINATED',
      recoveryKey: key,
      maximumSignedRevisions: { LICENSE: 7, FEATURE_FLAGS: 6, CONFIGURATION: 5 },
    });
    inspect(f.dbPath, (db) => {
      expect(db.prepare('SELECT DISTINCT status FROM devices').all()).toEqual([
        { status: 'REVOKED' },
      ]);
      expect(
        db.prepare('SELECT COUNT(*) n FROM device_credentials WHERE revoked_at IS NULL').get(),
      ).toEqual({ n: 0 });
      expect(db.prepare('SELECT sticky_declared_state FROM edge_control_runtime').get()).toEqual({
        sticky_declared_state: 'TERMINATED',
      });
    });
  });
  it.each(['missing', 'corrupt'] as const)(
    'fails closed for an established %s DB, never creates a replacement',
    async (mode) => {
      const f = await fixture();
      if (mode === 'missing') await unlink(f.dbPath);
      else await writeFile(f.dbPath, 'corrupt database');
      expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
      expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe('RECOVERY_REQUIRED');
      if (mode === 'missing')
        await expect(readFile(f.dbPath)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await readFile(f.dbPath, 'utf8')).toBe('corrupt database');
    },
  );
  it('retains a genuine FIRST_BOOT without creating a DB or security state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-first-boot-'));
    roots.push(root);
    const dbPath = join(root, 'new.db');
    const store = new DevelopmentRecoverySecurityStore(join(root, 'floor')),
      edgeSecretStore = new DevelopmentFileEdgeSecretStore(join(root, 'secret'));
    expect(await prepareProductionRecoveryUpgrade({ dbPath, store, edgeSecretStore })).toEqual({
      state: 'FIRST_BOOT',
    });
    expect(await assessStartupDatabase(dbPath, store, false, true)).toBe('FIRST_BOOT');
    expect(await readdir(root)).toEqual([]);
  });
  it('rejects a legacy DB rollback after a completed epoch-zero upgrade', async () => {
    const f = await fixture(),
      legacy = await readFile(f.dbPath);
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
    await writeFile(f.dbPath, legacy);
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({
      state: 'RECOVERY_REQUIRED',
      code: 'UPGRADE_SCHEMA_DOWNGRADE',
    });
    expect((await f.store.load()).minimumSchemaVersion).toBe(14);
  });
  it('aborts if an existing writer holds the database lock', async () => {
    const f = await fixture(),
      writer = new Database(f.dbPath);
    writer.exec('BEGIN IMMEDIATE');
    try {
      expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
      expect((await f.store.load()).upgradeJournal).toBeUndefined();
    } finally {
      writer.exec('ROLLBACK');
      writer.close();
    }
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
  });
  it('fails closed on a damaged safety artifact during retry', async () => {
    const f = await fixture();
    const save = f.store.save.bind(f.store);
    const interrupted: RecoverySecurityStore = {
      load: () => f.store.load(),
      mutate: (change) => f.store.mutate(change),
      save: async (value) => {
        await save(value);
        if (value.upgradeJournal?.phase === 'SNAPSHOT_READY') throw new Error('interrupted');
      },
    };
    expect((await prepareProductionRecoveryUpgrade({ ...f, store: interrupted })).state).toBe(
      'RECOVERY_REQUIRED',
    );
    const journal = (await f.store.load()).upgradeJournal!;
    await writeFile(join(journal.snapshotPath, 'database.enc'), 'damaged encrypted snapshot');
    expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
    inspect(f.dbPath, (db) => expect(inspectRecoveryUpgradeSchema(db)).toBe(13));
  });
  it.skipIf(process.platform !== 'win32')(
    'upgrades with the real Windows DPAPI floor and reopens that protected state',
    async () => {
      const f = await fixture(),
        path = join(f.root, 'floor.bin');
      const environment = {
        NODE_ENV: 'production',
        COMANVIEW_RECOVERY_SECURITY_STORE: 'windows-dpapi',
        COMANVIEW_RECOVERY_SECURITY_PATH: path,
      };
      const store = createRecoverySecurityStore(environment);
      expect(await prepareProductionRecoveryUpgrade({ ...f, store })).toEqual({
        state: 'UPGRADED',
      });
      const floor = await store.load();
      expect((await readFile(path)).toString()).not.toContain(floor.recoveryKey!);
      expect(
        await prepareProductionRecoveryUpgrade({
          ...f,
          store: createRecoverySecurityStore(environment),
        }),
      ).toEqual({ state: 'CURRENT' });
    },
    45_000,
  );
  it('aborts before mutation if the safety snapshot fails, and retries on restart', async () => {
    const f = await fixture(),
      before = data(f.dbPath);
    const spy = vi
      .spyOn(artifacts, 'createEncryptedBackupArtifact')
      .mockRejectedValueOnce(new Error('snapshot failure'));
    expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
    inspect(f.dbPath, (db) => expect(inspectRecoveryUpgradeSchema(db)).toBe(13));
    expect(data(f.dbPath)).toEqual(before);
    expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe('RECOVERY_REQUIRED');
    spy.mockRestore();
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
  });
  it('rolls back a SQL migration failure and safely retries', async () => {
    const f = await fixture(),
      original = Database.prototype.exec;
    const spy = vi.spyOn(Database.prototype, 'exec').mockImplementation(function (
      this: Database.Database,
      sql: string,
    ) {
      if (this.name === f.dbPath && sql.includes('CREATE TABLE `backup_records`'))
        throw new Error('injected SQL failure');
      return original.call(this, sql);
    });
    expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
    spy.mockRestore();
    inspect(f.dbPath, (db) => expect(inspectRecoveryUpgradeSchema(db)).toBe(13));
    expect(await prepareProductionRecoveryUpgrade(f)).toEqual({ state: 'UPGRADED' });
  });
  it.each(['snapshot-ready', 'pre-floor', 'post-floor', 'post-final-save'] as const)(
    'resumes durable interruption at %s',
    async (stage) => {
      const f = await fixture();
      let interrupted = false;
      const crashStore: RecoverySecurityStore = {
        load: () => f.store.load(),
        mutate: (change) => f.store.mutate(change),
        save: async (value) => {
          const trigger =
            stage === 'snapshot-ready'
              ? value.upgradeJournal?.phase === 'SNAPSHOT_READY'
              : stage === 'post-final-save'
                ? value.upgradeJournal === null && value.installationEstablished
                : value.upgradeJournal && value.maximumSignedRevisions.LICENSE === 4;
          if (!interrupted && trigger) {
            interrupted = true;
            if (stage !== 'pre-floor') await f.store.save(value);
            throw new Error('power interruption');
          }
          await f.store.save(value);
        },
      };
      const before = data(f.dbPath);
      expect((await prepareProductionRecoveryUpgrade({ ...f, store: crashStore })).state).toBe(
        'RECOVERY_REQUIRED',
      );
      expect(interrupted).toBe(true);
      inspect(f.dbPath, (db) =>
        expect(inspectRecoveryUpgradeSchema(db)).toBe(stage === 'snapshot-ready' ? 13 : 14),
      );
      const result = await prepareProductionRecoveryUpgrade({
        ...f,
        store: new DevelopmentRecoverySecurityStore(f.floorPath),
      });
      expect(result.state).toBe(stage === 'post-final-save' ? 'CURRENT' : 'UPGRADED');
      expect(data(f.dbPath)).toEqual(before);
      expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe('NORMAL');
    },
  );
  it.each([
    'floor-missing',
    'floor-corrupt',
    'wrong-binding',
    'epoch-rollback',
    'future-version',
    'partial-schema',
    'credential-mismatch',
    'missing-licensing-runtime',
  ] as const)('rejects ambiguous or backwards state: %s', async (mode) => {
    const f = await fixture();
    if (mode === 'floor-missing') inspect(f.dbPath, (db) => applyRecoveryUpgradeMigration(db));
    if (mode === 'floor-corrupt') await writeFile(f.floorPath, 'bad floor');
    if (mode === 'future-version') inspect(f.dbPath, (db) => db.pragma('user_version=15'));
    if (mode === 'partial-schema')
      inspect(f.dbPath, (db) =>
        db.exec('ALTER TABLE edge_installations ADD COLUMN recovery_epoch INTEGER DEFAULT 0'),
      );
    if (mode === 'missing-licensing-runtime')
      inspect(f.dbPath, (db) => db.exec('DELETE FROM edge_control_runtime'));
    if (mode === 'wrong-binding' || mode === 'epoch-rollback')
      await f.store.save(
        updateRecoverySecurityFloor(await f.store.load(), {
          installationEstablished: true,
          binding: {
            ...binding,
            edgeId: mode === 'wrong-binding' ? EntityId.generate().toString() : binding.edgeId,
          },
          recoveryEpoch: mode === 'epoch-rollback' ? 2 : 0,
        }),
      );
    if (mode === 'credential-mismatch')
      await f.edgeSecretStore.save({
        active: { credentialId: 'wrong', credential: 'x'.repeat(40) },
        pending: null,
      });
    const before = await readFile(f.dbPath);
    expect((await prepareProductionRecoveryUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
    expect(await readFile(f.dbPath)).toEqual(before);
    await expect(
      buildApp(f.dbPath, {
        recoverySecurityStore: f.store,
        edgeSecretStore: f.edgeSecretStore,
        enforceEstablishedInstallationSafety: true,
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  });
});
