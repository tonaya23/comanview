import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createEncryptedBackupArtifact } from './BackupArtifact.js';
import {
  completePendingRecoveryAtStartup,
  scheduleEmergencyRecovery,
} from './RecoveryCoordinator.js';
import {
  DevelopmentRecoverySecurityStore,
  initializeRecoverySecurityFloor,
  updateRecoverySecurityFloor,
  type RecoverySecurityStore,
} from './RecoverySecurityStore.js';
import { assessStartupDatabase } from './StartupRecoveryGuard.js';
import { insertAuditEntry } from '@comanview/database';

const roots: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));
vi.mock('@comanview/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@comanview/database')>();
  return { ...actual, insertAuditEntry: vi.fn(actual.insertAuditEntry) };
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const migrations = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cv-restore-lifecycle-'));
  roots.push(root);
  const dbPath = join(root, 'edge.db');
  const binding = { tenantId: randomUUID(), locationId: randomUUID(), edgeId: randomUUID() };
  const sqlite = new Database(dbPath);
  for (const name of (await readdir(migrations)).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort())
    sqlite.exec(await readFile(join(migrations, name), 'utf8'));
  sqlite
    .prepare(
      "INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,credential_id) VALUES('PRIMARY',?,?,?,1,'credential')",
    )
    .run(binding.edgeId, binding.tenantId, binding.locationId);
  const insert = sqlite.prepare(
    "INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,created_at) VALUES(?,?,?,'DINE_IN','POS',?,'MXN','OPEN',1)",
  );
  const beforeOrder = randomUUID(),
    laterOrder = randomUUID();
  insert.run(beforeOrder, binding.tenantId, binding.locationId, '1');
  const floorPath = join(root, 'floor.json'),
    store = new DevelopmentRecoverySecurityStore(floorPath);
  const floor = await initializeRecoverySecurityFloor({ store, sqlite, binding });
  const backupId = randomUUID();
  const artifact = await createEncryptedBackupArtifact({
    source: sqlite,
    destinationDirectory: join(root, 'backups'),
    backupId,
    binding: { ...binding, recoveryEpoch: 0 },
    recoveryKey: floor.recoveryKey!,
    trigger: 'MANUAL',
    destinationType: 'LOCAL',
    businessDate: null,
  });
  insert.run(laterOrder, binding.tenantId, binding.locationId, '2');
  sqlite.close();
  await scheduleEmergencyRecovery({
    backupId,
    artifactPath: artifact.artifactPath,
    recoveryKey: floor.recoveryKey!,
    binding,
    publicKeyring: {},
    securityStore: store,
    dbPath,
    now: new Date(),
    commandId: randomUUID(),
  });
  const journal = (await store.load()).journal!;
  return {
    root,
    dbPath,
    floorPath,
    store,
    journal,
    staged: journal.stagedDatabasePath!,
    beforeOrder,
    laterOrder,
  };
}
function orders(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return (
      db.prepare('SELECT id FROM orders ORDER BY order_number').all() as Array<{ id: string }>
    ).map((r) => r.id);
  } finally {
    db.close();
  }
}

describe('restore journal physical evidence', () => {
  it('preserves staging when scheduling fails after the journal was durably saved', async () => {
    const f = await fixture();
    await f.store.mutate((current) =>
      updateRecoverySecurityFloor(current, { journal: null, recoveryState: 'NORMAL' }),
    );
    const floor = await f.store.load();
    const injected: RecoverySecurityStore = {
      load: () => f.store.load(),
      mutate: (change) => f.store.mutate(change),
      save: async (value) => {
        await f.store.save(value);
        throw new Error('simulated post-persist failure');
      },
    };
    await expect(
      scheduleEmergencyRecovery({
        backupId: f.journal.backupId,
        artifactPath: f.journal.artifactPath,
        recoveryKey: floor.recoveryKey!,
        binding: floor.binding!,
        publicKeyring: {},
        securityStore: injected,
        dbPath: f.dbPath,
        now: new Date(),
        commandId: randomUUID(),
      }),
    ).rejects.toThrow('post-persist');
    const pending = (await f.store.load()).journal!;
    expect(pending.phase).toBe('PREPARING');
    await expect(fs.stat(pending.stagedDatabasePath!)).resolves.toBeDefined();
    expect(await completePendingRecoveryAtStartup(f)).toBe('COMPLETED');
    expect(orders(f.dbPath)).toEqual([f.beforeOrder]);
  });
  it('never reports completion on retry when verified staging disappears before swap', async () => {
    const f = await fixture();
    await rename(f.staged, `${f.staged}.held`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const store = new DevelopmentRecoverySecurityStore(f.floorPath);
      expect(await completePendingRecoveryAtStartup({ dbPath: f.dbPath, store })).toBe(
        'RECOVERY_REQUIRED',
      );
      expect(await store.load()).toMatchObject({
        recoveryState: 'RECOVERY_REQUIRED',
        recoveryEpoch: 0,
        journal: { phase: 'PREPARING', recoveryId: f.journal.recoveryId },
        pendingRecoveryAuthorizationAck: null,
      });
      expect(orders(f.dbPath)).toEqual([f.beforeOrder, f.laterOrder]);
      expect(await assessStartupDatabase(f.dbPath, store, true, true)).toBe('RECOVERY_REQUIRED');
    }
    await rename(`${f.staged}.held`, f.staged);
    const result = await completePendingRecoveryAtStartup(f);
    expect(result, (await f.store.load()).pendingRecoveryFailure?.code).toBe('COMPLETED');
    expect(orders(f.dbPath)).toEqual([f.beforeOrder]);
    expect(await f.store.load()).toMatchObject({
      recoveryState: 'NORMAL',
      recoveryEpoch: 1,
      journal: null,
    });
    expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe('NORMAL');
    expect(await completePendingRecoveryAtStartup(f)).toBe('NONE');
    expect((await f.store.load()).recoveryEpoch).toBe(1);
  });
  it.each(['QUIESCED', 'SWAPPED', 'VALIDATING', 'COMPLETED'] as const)(
    'resumes safely when saving %s fails before or after persistence',
    async (phase) => {
      for (const afterPersistence of [false, true]) {
        const f = await fixture();
        let interrupted = false;
        const injected: RecoverySecurityStore = {
          load: () => f.store.load(),
          mutate: (change) => f.store.mutate(change),
          save: async (value) => {
            if (!interrupted && (value.journal?.phase ?? 'COMPLETED') === phase) {
              interrupted = true;
              if (afterPersistence) await f.store.save(value);
              throw new Error('simulated journal interruption');
            }
            await f.store.save(value);
          },
        };
        expect(await completePendingRecoveryAtStartup({ dbPath: f.dbPath, store: injected })).toBe(
          'RECOVERY_REQUIRED',
        );
        expect(interrupted).toBe(true);
        const first = await f.store.load();
        if (phase !== 'COMPLETED') {
          expect(first.recoveryEpoch).toBe(0);
          expect(first.recoveryState).toBe('RECOVERY_REQUIRED');
          expect(first.journal).not.toBeNull();
          expect(await assessStartupDatabase(f.dbPath, f.store, true, true)).toBe(
            'RECOVERY_REQUIRED',
          );
        }
        const restarted = new DevelopmentRecoverySecurityStore(f.floorPath);
        const result = await completePendingRecoveryAtStartup({
          dbPath: f.dbPath,
          store: restarted,
        });
        expect(result, (await restarted.load()).pendingRecoveryFailure?.code).toBe(
          phase === 'COMPLETED' && afterPersistence ? 'NONE' : 'COMPLETED',
        );
        expect(orders(f.dbPath)).toEqual([f.beforeOrder]);
        expect(orders(`${f.dbPath}.pre-recovery-${f.journal.recoveryId}`)).toEqual([
          f.beforeOrder,
          f.laterOrder,
        ]);
        expect(await restarted.load()).toMatchObject({
          recoveryState: 'NORMAL',
          recoveryEpoch: 1,
          journal: null,
        });
        expect(await completePendingRecoveryAtStartup({ dbPath: f.dbPath, store: restarted })).toBe(
          'NONE',
        );
        const db = new Database(f.dbPath, { readonly: true });
        try {
          expect(
            db
              .prepare(
                "SELECT count(*) n FROM audit_log WHERE audit_id=? AND action='RECOVERY_VALIDATED'",
              )
              .get(f.journal.recoveryId),
          ).toEqual({ n: 1 });
        } finally {
          db.close();
        }
      }
    },
  );
  it.each(['preserve-original', 'install-staging'] as const)(
    'retries a failed filesystem rename: %s',
    async (point) => {
      const f = await fixture();
      const original = fs.rename;
      let interrupted = false;
      vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        if (!interrupted && source === (point === 'preserve-original' ? f.dbPath : f.staged)) {
          interrupted = true;
          throw Object.assign(new Error('simulated file in use'), { code: 'EBUSY' });
        }
        return original(source, destination);
      });
      expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
      expect(interrupted).toBe(true);
      expect(await f.store.load()).toMatchObject({
        recoveryState: 'RECOVERY_REQUIRED',
        recoveryEpoch: 0,
        journal: { phase: point === 'preserve-original' ? 'PREPARING' : 'QUIESCED' },
      });
      vi.restoreAllMocks();
      expect(await completePendingRecoveryAtStartup(f)).toBe('COMPLETED');
      expect(orders(f.dbPath)).toEqual([f.beforeOrder]);
    },
  );
  it.each(['QUIESCED', 'SWAPPED', 'VALIDATING'] as const)(
    'never trusts %s alone when the active DB is the original',
    async (phase) => {
      const f = await fixture();
      await rename(f.staged, `${f.staged}.held`);
      await f.store.mutate((current) =>
        updateRecoverySecurityFloor(current, { journal: { ...f.journal, phase } }),
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
        expect(await f.store.load()).toMatchObject({
          recoveryState: 'RECOVERY_REQUIRED',
          recoveryEpoch: 0,
          journal: { phase },
        });
        expect(orders(f.dbPath)).toEqual([f.beforeOrder, f.laterOrder]);
      }
    },
  );
  it('rejects legacy VALIDATING journals without snapshot evidence', async () => {
    const f = await fixture();
    const { stagedDatabaseSha256: ignored, ...legacy } = f.journal;
    void ignored;
    await f.store.mutate((current) =>
      updateRecoverySecurityFloor(current, { journal: { ...legacy, phase: 'VALIDATING' } }),
    );
    expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
    expect(await f.store.load()).toMatchObject({
      recoveryEpoch: 0,
      journal: { phase: 'VALIDATING' },
      pendingRecoveryFailure: { code: 'RECOVERY_SWAP_EVIDENCE_MISSING' },
    });
    expect(orders(f.dbPath)).toEqual([f.beforeOrder, f.laterOrder]);
  });
  it('does not mistake unrelated committed WAL data for the pristine snapshot', async () => {
    const f = await fixture();
    await rename(f.dbPath, `${f.dbPath}.preserved`);
    await rename(f.staged, f.dbPath);
    await f.store.mutate((current) =>
      updateRecoverySecurityFloor(current, { journal: { ...f.journal, phase: 'VALIDATING' } }),
    );
    const active = new Database(f.dbPath);
    active.pragma('journal_mode=WAL');
    active.prepare('UPDATE orders SET order_number=? WHERE id=?').run('unexpected', f.beforeOrder);
    try {
      expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
    } finally {
      active.close();
    }
    expect((await f.store.load()).recoveryEpoch).toBe(0);
  });
  it('rolls back epoch and the receipt together when validation auditing fails, then retries', async () => {
    const f = await fixture();
    vi.mocked(insertAuditEntry).mockImplementationOnce(() => {
      throw new Error('simulated audit failure');
    });
    expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
    expect(await f.store.load()).toMatchObject({
      recoveryEpoch: 0,
      recoveryState: 'RECOVERY_REQUIRED',
      journal: { phase: 'VALIDATING' },
    });
    const db = new Database(f.dbPath, { readonly: true, fileMustExist: true });
    try {
      expect(db.prepare('SELECT recovery_epoch FROM edge_installations').get()).toEqual({
        recovery_epoch: 0,
      });
      expect(
        db.prepare("SELECT count(*) n FROM audit_log WHERE action='RECOVERY_VALIDATED'").get(),
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    const result = await completePendingRecoveryAtStartup(f);
    expect(result, (await f.store.load()).pendingRecoveryFailure?.code).toBe('COMPLETED');
    expect(orders(f.dbPath)).toEqual([f.beforeOrder]);
  });
  it('rejects a different active DB even after a previous validation transaction committed', async () => {
    const f = await fixture();
    let interrupted = false;
    const injected: RecoverySecurityStore = {
      load: () => f.store.load(),
      save: (value) => f.store.save(value),
      mutate: async (change) => {
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated post-SQLite failure');
        }
        return f.store.mutate(change);
      },
    };
    expect(await completePendingRecoveryAtStartup({ dbPath: f.dbPath, store: injected })).toBe(
      'RECOVERY_REQUIRED',
    );
    await rename(f.dbPath, `${f.dbPath}.validated`);
    await rename(`${f.dbPath}.pre-recovery-${f.journal.recoveryId}`, f.dbPath);
    expect(await completePendingRecoveryAtStartup(f)).toBe('RECOVERY_REQUIRED');
    expect(orders(f.dbPath)).toEqual([f.beforeOrder, f.laterOrder]);
    expect((await f.store.load()).journal).not.toBeNull();
  });
});
