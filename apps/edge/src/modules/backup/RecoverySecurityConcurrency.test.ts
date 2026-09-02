import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addRevokedDevice,
  DevelopmentRecoverySecurityStore,
  ensureRecoveryKey,
  isDeviceRevokedByFloor,
  MemoryRecoverySecurityStore,
  updateRecoverySecurityFloor,
  type RecoverySecurityFloor,
} from './RecoverySecurityStore.js';
import { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { DeviceService } from '../devices/DeviceService.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function file() {
  const root = await mkdtemp(join(tmpdir(), 'cv-floor-race-'));
  roots.push(root);
  return join(root, 'floor.json');
}
const binding = { tenantId: 'tenant', locationId: 'location', edgeId: 'edge' };

describe.each(['memory', 'file'] as const)('central security-floor concurrency (%s)', (kind) => {
  const create = async () =>
    kind === 'memory'
      ? new MemoryRecoverySecurityStore()
      : new DevelopmentRecoverySecurityStore(await file());
  it('rejects stale saves while preserving the concurrently persisted revocation and lifecycle', async () => {
    const store = await create(),
      stale = await store.load();
    await store.mutate((f) =>
      updateRecoverySecurityFloor(addRevokedDevice(ensureRecoveryKey(f).floor, 'revoked'), {
        binding,
        installationEstablished: true,
        minimumSchemaVersion: 14,
        recoveryEpoch: 7,
        stickyDeclaredState: 'TERMINATED',
        maximumSignedRevisions: { LICENSE: 8, FEATURE_FLAGS: 4, CONFIGURATION: 6 },
      }),
    );
    expect(isDeviceRevokedByFloor(await store.load(), 'revoked')).toBe(true);
    await expect(
      store.save(updateRecoverySecurityFloor(stale, { offDeviceDirectory: 'old writer' })),
    ).rejects.toThrow('STALE_WRITE');
    await expect(
      store.mutate(() =>
        updateRecoverySecurityFloor(stale, { offDeviceDirectory: 'bypass attempt' }),
      ),
    ).rejects.toThrow('STALE_WRITE');
    expect(isDeviceRevokedByFloor(await store.load(), 'revoked')).toBe(true);
    expect(await store.load()).toMatchObject({
      binding,
      recoveryEpoch: 7,
      stickyDeclaredState: 'TERMINATED',
      maximumSignedRevisions: { LICENSE: 8, FEATURE_FLAGS: 4, CONFIGURATION: 6 },
      minimumSchemaVersion: 14,
    });
  });
  it('serializes concurrent transformations, including fresh save callers', async () => {
    const store = await create();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.mutate((f) =>
          updateRecoverySecurityFloor(addRevokedDevice(f, `device-${i}`), {
            maximumSignedRevisions: {
              ...f.maximumSignedRevisions,
              LICENSE: f.maximumSignedRevisions.LICENSE + 1,
            },
          }),
        ),
      ),
    );
    const floor = await store.load();
    expect(floor.maximumSignedRevisions.LICENSE).toBe(20);
    for (let i = 0; i < 20; i++) expect(isDeviceRevokedByFloor(floor, `device-${i}`)).toBe(true);
    await store.save(updateRecoverySecurityFloor(floor, { offDeviceDirectory: 'new setting' }));
    expect((await store.load()).maximumSignedRevisions.LICENSE).toBe(20);
  });
  it('rejects security rollback even with a fresh snapshot or mutate callback', async () => {
    const store = await create();
    await store.mutate((f) =>
      updateRecoverySecurityFloor(addRevokedDevice(ensureRecoveryKey(f).floor, 'revoked'), {
        binding,
        installationEstablished: true,
        minimumSchemaVersion: 14,
        recoveryEpoch: 7,
        recoveryKeyExportedAt: '2026-09-01T00:00:00Z',
        stickyDeclaredState: 'TERMINATED',
        maximumSignedRevisions: { LICENSE: 8, FEATURE_FLAGS: 4, CONFIGURATION: 6 },
      }),
    );
    const attempts: Array<Partial<RecoverySecurityFloor>> = [
      { recoveryEpoch: 6 },
      { installationEstablished: false },
      // Deliberately simulate an untyped caller removing the optional schema floor.
      { minimumSchemaVersion: undefined } as unknown as Partial<RecoverySecurityFloor>,
      { stickyDeclaredState: 'SUSPENDED' },
      { maximumSignedRevisions: { LICENSE: 7, FEATURE_FLAGS: 4, CONFIGURATION: 6 } },
      { revokedDeviceBloom: Buffer.alloc(8192).toString('base64url') },
      { recoveryKey: null },
      { recoveryKeyExportedAt: null },
    ];
    for (const attempt of attempts) {
      await expect(store.mutate((f) => updateRecoverySecurityFloor(f, attempt))).rejects.toThrow(
        'ROLLBACK',
      );
      await expect(
        store.save(updateRecoverySecurityFloor(await store.load(), attempt)),
      ).rejects.toThrow('ROLLBACK');
    }
    await expect(
      store.mutate((f) =>
        updateRecoverySecurityFloor(f, { binding: { ...binding, edgeId: 'different' } }),
      ),
    ).rejects.toThrow('BINDING_MISMATCH');
    await expect(
      store.save(updateRecoverySecurityFloor(await store.load(), { binding: null })),
    ).rejects.toThrow('BINDING_MISMATCH');
    expect(isDeviceRevokedByFloor(await store.load(), 'revoked')).toBe(true);
  });
});

it('concurrent DeviceService revocations both persist before the operational revoke', async () => {
  const store = new MemoryRecoverySecurityStore(),
    revoked: string[] = [];
  const service = new DeviceService(
    {
      auditEntityForCommand: () => null,
      registeredIdentity: () => ({ device: { status: 'ACTIVE' } }),
      revoke: ({ deviceId }: { deviceId: string }) => {
        revoked.push(deviceId);
      },
    } as any,
    {} as any,
    binding,
    {},
    undefined,
    store,
  );
  const actor = {
    userId: 'owner',
    deviceId: 'admin',
    sessionId: 'session',
    roles: ['OWNER'],
  } as any;
  await Promise.all(['a', 'b'].map((id) => service.revoke(id, 'fixture', id, actor)));
  expect(revoked.sort()).toEqual(['a', 'b']);
  for (const id of revoked) expect(isDeviceRevokedByFloor(await store.load(), id)).toBe(true);
});

it('serializes independent Node writers of the same durable floor', async () => {
  const path = await file();
  const code = `import {DevelopmentRecoverySecurityStore,addRevokedDevice,updateRecoverySecurityFloor} from ${JSON.stringify(new URL('./RecoverySecurityStore.ts', import.meta.url).href)};
    const store=new DevelopmentRecoverySecurityStore(process.argv[1]);
    for(let i=0;i<8;i++)await store.mutate(f=>updateRecoverySecurityFloor(addRevokedDevice(f,process.argv[2]+'-'+i),{
      maximumSignedRevisions:{...f.maximumSignedRevisions,LICENSE:f.maximumSignedRevisions.LICENSE+1}}));`;
  await Promise.all(
    ['a', 'b', 'c'].map((id) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', code, path, id],
        { windowsHide: true },
      ),
    ),
  );
  const floor = await new DevelopmentRecoverySecurityStore(path).load();
  expect(floor.maximumSignedRevisions.LICENSE).toBe(24);
  for (const id of ['a', 'b', 'c'])
    for (let i = 0; i < 8; i++) expect(isDeviceRevokedByFloor(floor, `${id}-${i}`)).toBe(true);
});

it('fails closed on a held lease and recovers an abandoned stale lease without replacing the floor', async () => {
  const path = await file(),
    store = new DevelopmentRecoverySecurityStore(path);
  await store.mutate((f) => addRevokedDevice(f, 'revoked'));
  const before = await readFile(path);
  await mkdir(path + '.lock');
  await expect(store.load()).rejects.toThrow('SECURITY_LOCKED');
  expect(await readFile(path)).toEqual(before);
  const past = new Date(Date.now() - 60_000);
  await utimes(path + '.lock', past, past);
  expect(isDeviceRevokedByFloor(await store.load(), 'revoked')).toBe(true);
  expect(await readFile(path)).toEqual(before);
});

it.each([false, true])(
  'delayed recovery ACK preserves concurrent revocation and replacement ACK=%s',
  async (replaced) => {
    const store = new MemoryRecoverySecurityStore();
    const ack = { authorizationId: 'auth', commandId: 'ack', consumedAt: '2026-09-01T00:00:00Z' };
    await store.mutate((f) =>
      updateRecoverySecurityFloor(f, { pendingRecoveryAuthorizationAck: ack }),
    );
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      entered = new Promise<void>((r) => {
        started = r;
      });
    const manager = new EdgeLicenseManager(
      { pendingAcks: () => [], pendingInstallationAuthorizationAck: () => null } as any,
      {
        acknowledgeRecovery: async () => {
          started();
          await gate;
        },
      } as any,
      { enforcementEnabled: false } as any,
      binding,
      undefined,
      store,
    );
    const flushing = manager.flushAcks();
    await entered;
    await store.mutate((f) =>
      updateRecoverySecurityFloor(addRevokedDevice(f, 'revoked'), {
        recoveryEpoch: 8,
        stickyDeclaredState: 'TERMINATED',
        maximumSignedRevisions: { LICENSE: 9, FEATURE_FLAGS: 3, CONFIGURATION: 4 },
        pendingRecoveryAuthorizationAck: replaced ? { ...ack, commandId: 'new-ack' } : ack,
      }),
    );
    release();
    await flushing;
    const floor = await store.load();
    expect(isDeviceRevokedByFloor(floor, 'revoked')).toBe(true);
    expect(floor).toMatchObject({
      recoveryEpoch: 8,
      stickyDeclaredState: 'TERMINATED',
      maximumSignedRevisions: { LICENSE: 9 },
    });
    expect(floor.pendingRecoveryAuthorizationAck?.commandId ?? null).toBe(
      replaced ? 'new-ack' : null,
    );
  },
);
