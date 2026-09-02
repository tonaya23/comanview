import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEdgeDatabase, EdgeControlRepository } from '@comanview/database';
import { hashSignedEnvelope, signControlDocument } from '@comanview/licensing';
import type { LicenseDocumentPayload } from '@comanview/contracts';
import { EdgeLicenseManager } from './EdgeLicenseManager.js';
import {
  applySignedLicenseTransition,
  DevelopmentRecoverySecurityStore,
  initializeRecoverySecurityFloor,
  updateRecoverySecurityFloor,
} from '../backup/RecoverySecurityStore.js';
import { stageLicense } from './LicensingSecurity.js';
import { ControlStateWorker } from './ControlStateWorker.js';
import { createEncryptedBackupArtifact } from '../backup/BackupArtifact.js';
import {
  completePendingRecoveryAtStartup,
  scheduleEmergencyRecovery,
} from '../backup/RecoveryCoordinator.js';
import { prepareProductionRecoveryUpgrade } from '../backup/ProductionRecoveryUpgrade.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cv-licensing-floor-'));
  roots.push(root);
  const dbPath = join(root, 'edge.db'),
    floorPath = join(root, 'floor.json');
  let db = createEdgeDatabase(dbPath);
  const migrations = new URL('../../../../../migrations/edge/', import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((n) => /^\d{4}.*sql$/.test(n))
    .sort())
    db.sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const binding = { tenantId: randomUUID(), locationId: randomUUID(), edgeId: randomUUID() };
  db.sqlite
    .prepare(
      "INSERT INTO edge_installations(singleton_key,tenant_id,location_id,edge_id,created_at,provisioning_state) VALUES('PRIMARY',?,?,?,1,'ACTIVE')",
    )
    .run(binding.tenantId, binding.locationId, binding.edgeId);
  const store = new DevelopmentRecoverySecurityStore(floorPath);
  await initializeRecoverySecurityFloor({ store, sqlite: db.sqlite, binding });
  const keys = generateKeyPairSync('ed25519'),
    privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const config = {
    enforcementEnabled: true,
    publicKeyring: { test: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    pullIntervalMs: 300000,
    maxBackoffMs: 3600000,
    checkpointIntervalMs: 60000,
  };
  function signed(
    revision: number,
    state: LicenseDocumentPayload['declaredState'] = 'ACTIVE',
    overrides: Partial<LicenseDocumentPayload> = {},
  ) {
    const now = Date.now();
    const payload: LicenseDocumentPayload = {
      documentType: 'LICENSE',
      formatVersion: 1,
      documentId: randomUUID(),
      revision,
      ...binding,
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
      graceUntil: new Date(now + 7200000).toISOString(),
      declaredState: state,
      planCode: 'TEST',
      capabilities: ['CORE_POS'],
      ...overrides,
    };
    const envelope = signControlDocument(payload, 'test', privateKey);
    return { revision, envelope, documentHash: hashSignedEnvelope(envelope) };
  }
  const acks: number[] = [];
  function manager(document: ReturnType<typeof signed> | null) {
    return new EdgeLicenseManager(
      new EdgeControlRepository(db.db),
      {
        pull: async () => ({
          desiredControlRevision: document?.revision ?? 0,
          cloudTime: new Date().toISOString(),
          license: document,
          featureFlags: null,
          configuration: null,
        }),
        acknowledge: async (input: { revision: number }) => {
          acks.push(input.revision);
        },
      } as never,
      config,
      binding,
      undefined,
      store,
      db.sqlite,
    );
  }
  async function restore(artifact: { artifactPath: string }, backupId: string) {
    await store.mutate((f) =>
      updateRecoverySecurityFloor(f, { recoveryState: 'RECOVERY_REQUIRED' }),
    );
    await scheduleEmergencyRecovery({
      commandId: randomUUID(),
      backupId,
      artifactPath: artifact.artifactPath,
      recoveryKey: (await store.load()).recoveryKey!,
      binding,
      publicKeyring: config.publicKeyring,
      securityStore: store,
      dbPath,
      now: new Date(),
    });
    db.close();
    expect(await completePendingRecoveryAtStartup({ dbPath, store })).toBe('COMPLETED');
    db = createEdgeDatabase(dbPath);
  }
  async function backup() {
    const backupId = randomUUID();
    const artifact = await createEncryptedBackupArtifact({
      source: db.sqlite,
      destinationDirectory: join(root, 'backups'),
      backupId,
      binding: { ...binding, recoveryEpoch: (await store.load()).recoveryEpoch },
      recoveryKey: (await store.load()).recoveryKey!,
      trigger: 'MANUAL',
      destinationType: 'LOCAL',
      businessDate: null,
    });
    return { artifact, backupId };
  }
  return {
    root,
    dbPath,
    floorPath,
    store,
    binding,
    config,
    signed,
    manager,
    restore,
    backup,
    acks,
    get db() {
      return db;
    },
    get repo() {
      return new EdgeControlRepository(db.db);
    },
    close: () => db.close(),
  };
}
describe('revision-bound Licensing Security Floor', () => {
  it('real restore rev1 / floor rev3 TERMINATED rejects rev2, blocks Orders and later permits legitimate rev4 through restart and another restore', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(1)).pullOnce();
      const b = await f.backup();
      await f.manager(f.signed(3, 'TERMINATED')).pullOnce();
      await f.restore(b.artifact, b.backupId);
      expect(f.repo.currentDocument('LICENSE')).toBeNull();
      const stale = f.manager(f.signed(2));
      await stale.pullOnce();
      expect(f.repo.currentDocument('LICENSE')).toBeNull();
      expect(stale.effectiveCapabilities().mode).not.toBe('FULL');
      expect(() => stale.assertAllowed('ORDER_CREATE', 'CORE_POS')).toThrow();
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 3 },
        stickyDeclaredState: 'TERMINATED',
      });
      const revision4 = f.signed(4);
      const renewed = f.manager(revision4);
      await renewed.pullOnce();
      expect(renewed.effectiveCapabilities().mode).toBe('FULL');
      expect(() => renewed.assertAllowed('ORDER_CREATE', 'CORE_POS')).not.toThrow();
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 4 },
        stickyDeclaredState: null,
      });
      expect(
        await prepareProductionRecoveryUpgrade({
          dbPath: f.dbPath,
          store: new DevelopmentRecoverySecurityStore(f.floorPath),
          edgeSecretStore: { hasPersistedState: async () => true } as never,
        }),
      ).toEqual({ state: 'CURRENT' });
      await f.restore(b.artifact, b.backupId);
      expect(f.manager(null).effectiveCapabilities().mode).not.toBe('FULL');
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 4 },
        stickyDeclaredState: null,
      });
      expect(f.acks).not.toContain(2);
      await f.manager(revision4).pullOnce();
      expect(f.manager(null).effectiveCapabilities().mode).toBe('FULL');
    } finally {
      f.close();
    }
  });
  it.each([1, 2, 3])(
    'rejects ACTIVE rev%s against TERMINATED rev3, including no-current SQLite',
    async (revision) => {
      const f = await fixture();
      try {
        await f.manager(f.signed(3, 'TERMINATED')).pullOnce();
        f.db.sqlite.exec('UPDATE edge_control_documents SET is_current=0');
        const manager = f.manager(f.signed(revision));
        await manager.pullOnce();
        expect(f.repo.currentDocument('LICENSE')).toBeNull();
        expect(manager.effectiveCapabilities().mode).not.toBe('FULL');
        expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).toThrow();
        expect(await f.store.load()).toMatchObject({
          maximumSignedRevisions: { LICENSE: 3 },
          stickyDeclaredState: 'TERMINATED',
        });
      } finally {
        f.close();
      }
    },
  );
  it.each(['signature', 'kid', 'binding', 'expired', 'future'] as const)(
    'rejects invalid rev4 (%s) without preparing or advancing the floor',
    async (mode) => {
      const f = await fixture();
      try {
        await f.manager(f.signed(3, 'TERMINATED')).pullOnce();
        const before = await f.store.load();
        const document = f.signed(
          4,
          'ACTIVE',
          mode === 'binding'
            ? { edgeId: randomUUID() }
            : mode === 'expired'
              ? { expiresAt: new Date(Date.now() - 500).toISOString() }
              : mode === 'future'
                ? { issuedAt: new Date(Date.now() + 3600000).toISOString() }
                : {},
        );
        if (mode === 'signature') document.envelope.signature = 'A'.repeat(86);
        if (mode === 'kid')
          document.envelope.protected = Buffer.from(
            JSON.stringify({ typ: 'LICENSE', formatVersion: 1, alg: 'EdDSA', kid: 'unknown' }),
          ).toString('base64url');
        document.documentHash = hashSignedEnvelope(document.envelope);
        const manager = f.manager(document);
        await manager.pullOnce();
        expect(manager.effectiveCapabilities().mode).toBe('TERMINATED_BLOCKED');
        expect(await f.store.load()).toEqual(before);
        expect(f.repo.currentDocument('LICENSE')?.revision).toBe(3);
      } finally {
        f.close();
      }
    },
  );
  it('generic mutate/save cannot relax sticky or forge a decision, even with a higher revision', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(3, 'TERMINATED')).pullOnce();
      const relax = (floor: Awaited<ReturnType<typeof f.store.load>>) =>
        updateRecoverySecurityFloor(floor, {
          maximumSignedRevisions: { ...floor.maximumSignedRevisions, LICENSE: 4 },
          stickyDeclaredState: null,
        });
      await expect(f.store.mutate(relax)).rejects.toThrow('ROLLBACK');
      await expect(f.store.save(relax(await f.store.load()))).rejects.toThrow('ROLLBACK');
      await expect(
        f.store.mutate((floor) =>
          updateRecoverySecurityFloor(relax(floor), {
            licenseDecision: {
              revision: 4,
              documentHash: 'a'.repeat(64),
              stickyDeclaredState: null,
            },
          }),
        ),
      ).rejects.toThrow('PROTECTED');
      const stale = await f.store.load();
      await f.manager(f.signed(4)).pullOnce();
      await expect(
        f.store.save(updateRecoverySecurityFloor(stale, { offDeviceDirectory: 'stale' })),
      ).rejects.toThrow('STALE');
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 4 },
        stickyDeclaredState: null,
      });
    } finally {
      f.close();
    }
  });
  it.each(['before-floor', 'after-floor'] as const)(
    'resumes a real staged decision after failure %s without incompatible startup',
    async (window) => {
      const f = await fixture();
      try {
        await f.manager(f.signed(3, 'TERMINATED')).pullOnce();
        const document = f.signed(4);
        await expect(
          applySignedLicenseTransition(f.store, {
            envelope: document.envelope,
            publicKeyring: f.config.publicKeyring,
            binding: f.binding,
            now: new Date(),
            prepare: (payload, hash) => {
              stageLicense(f.db.sqlite, payload, document.envelope, hash, new Date());
              if (window === 'before-floor') throw new Error('INJECTED');
            },
            activate: () => {
              throw new Error('INJECTED');
            },
          }),
        ).rejects.toThrow('INJECTED');
        expect(f.repo.currentDocument('LICENSE')?.revision).toBe(3);
        expect(f.manager(null).effectiveCapabilities().mode).not.toBe('FULL');
        const restarted = new DevelopmentRecoverySecurityStore(f.floorPath);
        expect(
          await prepareProductionRecoveryUpgrade({
            dbPath: f.dbPath,
            store: restarted,
            edgeSecretStore: { hasPersistedState: async () => true } as never,
          }),
        ).toEqual({ state: 'CURRENT' });
        await f.store.load();
        if (window === 'before-floor') expect(f.repo.currentDocument('LICENSE')?.revision).toBe(3);
        else expect(f.repo.currentDocument('LICENSE')?.revision).toBe(4);
        await f.manager(document).pullOnce();
        expect(f.manager(null).effectiveCapabilities().mode).toBe('FULL');
        expect(await f.store.load()).toMatchObject({
          maximumSignedRevisions: { LICENSE: 4 },
          stickyDeclaredState: null,
          licensePending: null,
        });
      } finally {
        f.close();
      }
    },
  );
  it('a first interrupted LICENSE preparation never becomes a generic accepted revision on restart', async () => {
    const f = await fixture();
    try {
      const document = f.signed(1);
      await expect(
        applySignedLicenseTransition(f.store, {
          envelope: document.envelope,
          publicKeyring: f.config.publicKeyring,
          binding: f.binding,
          now: new Date(),
          prepare: (payload, hash) => {
            stageLicense(f.db.sqlite, payload, document.envelope, hash, new Date());
            throw new Error('INJECTED');
          },
          activate: () => {
            throw new Error('UNREACHABLE');
          },
        }),
      ).rejects.toThrow('INJECTED');
      expect(
        await prepareProductionRecoveryUpgrade({
          dbPath: f.dbPath,
          store: f.store,
          edgeSecretStore: { hasPersistedState: async () => true } as never,
        }),
      ).toEqual({ state: 'CURRENT' });
      await initializeRecoverySecurityFloor({
        store: f.store,
        sqlite: f.db.sqlite,
        binding: f.binding,
      });
      expect((await f.store.load()).maximumSignedRevisions.LICENSE).toBe(0);
      expect(f.manager(null).effectiveCapabilities().mode).toBe('NO_VALID_LICENSE');
      await f.manager(document).pullOnce();
      expect(f.manager(null).effectiveCapabilities().mode).toBe('FULL');
    } finally {
      f.close();
    }
  });
  it('concurrent valid writers and a delayed worker/ACK cannot restore an older licensing decision', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(1)).pullOnce();
      await Promise.all([
        f.manager(f.signed(3, 'TERMINATED')).pullOnce(),
        f.manager(f.signed(5)).pullOnce(),
        f.manager(f.signed(4, 'TERMINATED')).pullOnce(),
      ]);
      expect(f.repo.currentDocument('LICENSE')?.revision).toBe(5);
      const manager = f.manager(f.signed(2)),
        worker = new ControlStateWorker(manager, f.config);
      worker.start();
      try {
        await vi.waitFor(() =>
          expect(f.repo.getRuntime().lastError).toBe('CONTROL_DOCUMENT_VALIDATION_FAILED'),
        );
      } finally {
        worker.stop();
      }
      await manager.flushAcks();
      expect(f.acks).not.toContain(2);
      expect(f.acks).not.toContain(4);
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 5 },
        stickyDeclaredState: null,
      });
    } finally {
      f.close();
    }
  });
  it('EffectiveCapabilities ignores stale current rows and invalidates its policy cache after an independent writer', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(1)).pullOnce();
      const manager = f.manager(null);
      const independent = new DevelopmentRecoverySecurityStore(f.floorPath);
      await independent.mutate((floor) =>
        updateRecoverySecurityFloor(floor, {
          maximumSignedRevisions: { ...floor.maximumSignedRevisions, LICENSE: 3 },
          stickyDeclaredState: 'TERMINATED',
        }),
      );
      expect(manager.effectiveCapabilities().mode).not.toBe('FULL');
      expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).toThrow();
      await f.store.load();
      expect(manager.effectiveCapabilities().mode).not.toBe('FULL');
    } finally {
      f.close();
    }
  });
  it('preserves SUSPENDED at the same revision and permits an authenticated later reactivation', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(3, 'SUSPENDED')).pullOnce();
      await f.manager(f.signed(3)).pullOnce();
      expect(f.manager(null).effectiveCapabilities()).toMatchObject({
        mode: 'SUSPENDED_BLOCKED',
        declaredState: 'SUSPENDED',
      });
      await f.manager(f.signed(4)).pullOnce();
      expect(f.manager(null).effectiveCapabilities().mode).toBe('FULL');
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 4 },
        stickyDeclaredState: null,
      });
    } finally {
      f.close();
    }
  });
  it('retains Guaranteed Shift and Protected Orders without treating those exceptions as commercial reactivation', async () => {
    const f = await fixture();
    try {
      await f.manager(f.signed(1)).pullOnce();
      const register = randomUUID(),
        cash = randomUUID(),
        order = randomUUID();
      f.db.sqlite
        .prepare(
          "INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,created_at) VALUES(?,?,?,'Test','MXN',1)",
        )
        .run(register, f.binding.tenantId, f.binding.locationId);
      f.db.sqlite
        .prepare(
          `INSERT INTO cash_sessions(id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,opened_at,opened_by,open_command_id,opened_license_revision,opened_license_mode)
        VALUES(?,?,?,?,0,'MXN','2026-09-02','OPEN',1,'owner',?,1,'FULL')`,
        )
        .run(cash, register, f.binding.tenantId, f.binding.locationId, randomUUID());
      f.db.sqlite
        .prepare(
          "INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,created_at) VALUES(?,?,?,'DINE_IN','POS','1','MXN','OPEN',1)",
        )
        .run(order, f.binding.tenantId, f.binding.locationId);
      const manager = f.manager(f.signed(3, 'TERMINATED'));
      await manager.pullOnce();
      expect(manager.effectiveCapabilities()).toMatchObject({
        mode: 'GUARANTEED_SHIFT',
        declaredState: 'TERMINATED',
      });
      expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).not.toThrow();
      expect(() => manager.assertAllowed('CASH_SESSION_OPEN_NORMAL', 'CORE_POS')).toThrow();
      f.db.sqlite
        .prepare("UPDATE cash_sessions SET status='CLOSED',closed_at=? WHERE id=?")
        .run(Date.now(), cash);
      expect(manager.effectiveCapabilities().mode).toBe('PROTECTED_OPERATIONS');
      expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).toThrow();
      expect(() => manager.assertAllowed('PAYMENT_CREATE', 'CORE_POS', order)).not.toThrow();
      expect(() => manager.assertAllowed('CASH_SESSION_OPEN_RECOVERY', 'CORE_POS')).not.toThrow();
      expect(await f.store.load()).toMatchObject({
        maximumSignedRevisions: { LICENSE: 3 },
        stickyDeclaredState: 'TERMINATED',
      });
    } finally {
      f.close();
    }
  });
});
