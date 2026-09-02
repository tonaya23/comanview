import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  addRevokedDevice,
  MemoryRecoverySecurityStore,
  updateRecoverySecurityFloor,
} from './RecoverySecurityStore.js';
import { completePendingRecoveryAtStartup } from './RecoveryCoordinator.js';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const targetBinding = {
  tenantId: '01991a00-0000-7000-8000-000000000701',
  locationId: '01991a00-0000-7000-8000-000000000702',
  edgeId: '01991a00-0000-7000-8000-000000000703',
};
const deviceId = '01991a00-0000-7000-8000-000000000721';
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
function database(path: string, status = 'ACTIVE') {
  const db = new Database(path),
    directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort())
    db.exec(readFileSync(join(directory, name), 'utf8'));
  db.exec(`INSERT INTO edge_installations(singleton_key,tenant_id,location_id,edge_id,recovery_epoch,created_at,credential_id) VALUES('PRIMARY','old-tenant','old-location','old-edge',0,1,'credential');
    INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,payload,occurred_at,local_sequence,sync_status) VALUES('pending','ORDER_CREATED','ORDER','order','{}',1,1,'PENDING');
    INSERT INTO devices(id,tenant_id,location_id,name,device_type,status,session_timeout_minutes,created_at) VALUES('${deviceId}','old-tenant','old-location','Fixture','POS','${status}',60,1);
    INSERT INTO device_credentials(credential_id,device_id,credential_hash,created_at) VALUES('credential','${deviceId}','hash',1);
    INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES('user','old-tenant','old-location','User','ACTIVE','hash',1);
    INSERT INTO auth_sessions(id,user_id,device_id,tenant_id,location_id,token_hash,login_at,last_activity,expires_at) VALUES('session','user','${deviceId}','old-tenant','old-location','hash',1,1,9999999999999);
    INSERT INTO edge_control_documents(document_id,document_type,revision,document_hash,envelope_json,payload_json,issued_at,received_at,is_current) VALUES('doc','LICENSE',1,'hash','{}','{}',1,1,1);`);
  db.pragma('journal_mode=DELETE');
  db.close();
}
function snapshotHash(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
async function completeExpected(input: Parameters<typeof completePendingRecoveryAtStartup>[0]) {
  const result = await completePendingRecoveryAtStartup(input);
  expect(result, (await input.store.load()).pendingRecoveryFailure?.code).toBe('COMPLETED');
  return result;
}
describe('recovery startup merge', () => {
  it('advances epoch and prevents revoked Device/licensing rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-recovery-'));
    roots.push(root);
    const current = join(root, 'edge.db'),
      staged = join(root, 'staged.db');
    database(current);
    database(staged);
    const store = new MemoryRecoverySecurityStore();
    let floor = await store.load();
    floor = addRevokedDevice(floor, deviceId);
    floor = updateRecoverySecurityFloor(floor, {
      installationEstablished: true,
      binding: targetBinding,
      recoveryEpoch: 4,
      stickyDeclaredState: 'TERMINATED',
      maximumSignedRevisions: { LICENSE: 3, FEATURE_FLAGS: 2, CONFIGURATION: 2 },
      recoveryState: 'RECOVERY_IN_PROGRESS',
      journal: {
        recoveryId: 'r1',
        commandId: '01991a00-0000-7000-8000-000000000707',
        backupId: '01991a00-0000-7000-8000-000000000705',
        artifactPath: 'artifact',
        phase: 'PREPARING',
        startedAt: new Date().toISOString(),
        originalDatabasePath: current,
        stagedDatabasePath: staged,
        stagedDatabaseSha256: snapshotHash(staged),
        nextRecoveryEpoch: 5,
        authorizationId: null,
        targetBinding: {
          tenantId: '01991a00-0000-7000-8000-000000000701',
          locationId: '01991a00-0000-7000-8000-000000000702',
          edgeId: '01991a00-0000-7000-8000-000000000703',
        },
        enteredFromRecoveryRequired: false,
      },
    });
    await store.save(floor);
    expect(await completeExpected({ dbPath: current, store })).toBe('COMPLETED');
    const restored = new Database(current, { readonly: true });
    expect(restored.prepare('SELECT recovery_epoch FROM edge_installations').get()).toEqual({
      recovery_epoch: 5,
    });
    expect(
      restored.prepare('SELECT tenant_id,location_id,edge_id FROM edge_installations').get(),
    ).toEqual({
      tenant_id: '01991a00-0000-7000-8000-000000000701',
      location_id: '01991a00-0000-7000-8000-000000000702',
      edge_id: '01991a00-0000-7000-8000-000000000703',
    });
    expect(restored.prepare('SELECT recovery_epoch FROM event_log').get()).toEqual({
      recovery_epoch: 5,
    });
    expect(restored.prepare('SELECT status FROM devices').get()).toEqual({ status: 'REVOKED' });
    expect(
      restored.prepare('SELECT sticky_declared_state FROM edge_control_runtime').get(),
    ).toEqual({ sticky_declared_state: 'TERMINATED' });
    expect(restored.prepare('SELECT is_current FROM edge_control_documents').get()).toEqual({
      is_current: 0,
    });
    restored.close();
    expect(await store.load()).toMatchObject({
      recoveryState: 'NORMAL',
      recoveryEpoch: 5,
      journal: null,
    });
  });
  it('revokes every restored Device credential during an authorized hardware replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-recovery-hardware-'));
    roots.push(root);
    const current = join(root, 'edge.db'),
      staged = join(root, 'staged.db');
    database(current);
    database(staged);
    const store = new MemoryRecoverySecurityStore();
    let floor = await store.load();
    floor = updateRecoverySecurityFloor(floor, {
      installationEstablished: true,
      binding: targetBinding,
      recoveryEpoch: 2,
      recoveryState: 'RECOVERY_IN_PROGRESS',
      journal: {
        recoveryId: 'r-hardware',
        commandId: '01991a00-0000-7000-8000-000000000710',
        backupId: '01991a00-0000-7000-8000-000000000711',
        artifactPath: 'artifact',
        phase: 'PREPARING',
        startedAt: new Date().toISOString(),
        originalDatabasePath: current,
        stagedDatabasePath: staged,
        stagedDatabaseSha256: snapshotHash(staged),
        nextRecoveryEpoch: 3,
        authorizationId: '01991a00-0000-7000-8000-000000000712',
        targetBinding: {
          tenantId: '01991a00-0000-7000-8000-000000000701',
          locationId: '01991a00-0000-7000-8000-000000000702',
          edgeId: '01991a00-0000-7000-8000-000000000703',
        },
        enteredFromRecoveryRequired: true,
      },
    });
    await store.save(floor);
    expect(await completeExpected({ dbPath: current, store })).toBe('COMPLETED');
    const restored = new Database(current, { readonly: true });
    expect(
      restored.prepare('SELECT status,revoked_at FROM devices WHERE id=?').get(deviceId),
    ).toMatchObject({ status: 'REVOKED' });
    expect(
      restored.prepare('SELECT revoked_at FROM device_credentials WHERE device_id=?').get(deviceId),
    ).toMatchObject({ revoked_at: expect.any(Number) });
    expect(
      restored.prepare('SELECT revoked_at FROM auth_sessions WHERE device_id=?').get(deviceId),
    ).toMatchObject({ revoked_at: expect.any(Number) });
    restored.close();
    expect(await store.load()).toMatchObject({
      recoveryEpoch: 3,
      pendingRecoveryAuthorizationAck: { authorizationId: '01991a00-0000-7000-8000-000000000712' },
    });
  });
  it('resumes a crash after the original database was preserved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-recovery-crash-'));
    roots.push(root);
    const current = join(root, 'edge.db'),
      staged = join(root, 'staged.db');
    database(staged);
    const store = new MemoryRecoverySecurityStore();
    let floor = await store.load();
    floor = updateRecoverySecurityFloor(floor, {
      installationEstablished: true,
      binding: targetBinding,
      recoveryState: 'RECOVERY_IN_PROGRESS',
      journal: {
        recoveryId: 'r2',
        commandId: '01991a00-0000-7000-8000-000000000708',
        backupId: '01991a00-0000-7000-8000-000000000706',
        artifactPath: 'artifact',
        phase: 'QUIESCED',
        startedAt: new Date().toISOString(),
        originalDatabasePath: current,
        stagedDatabasePath: staged,
        stagedDatabaseSha256: snapshotHash(staged),
        nextRecoveryEpoch: 1,
        authorizationId: null,
        targetBinding: {
          tenantId: '01991a00-0000-7000-8000-000000000701',
          locationId: '01991a00-0000-7000-8000-000000000702',
          edgeId: '01991a00-0000-7000-8000-000000000703',
        },
        enteredFromRecoveryRequired: true,
      },
    });
    await store.save(floor);
    expect(await completeExpected({ dbPath: current, store })).toBe('COMPLETED');
    const restored = new Database(current, { readonly: true });
    expect(restored.prepare('SELECT recovery_epoch FROM edge_installations').get()).toEqual({
      recovery_epoch: 1,
    });
    restored.close();
  });
  it('keeps recovery required and preserves the former database when the staged database cannot be opened', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cv-recovery-invalid-'));
    roots.push(root);
    const current = join(root, 'edge.db'),
      staged = join(root, 'staged.db');
    database(current);
    await writeFile(staged, 'not a sqlite database');
    const store = new MemoryRecoverySecurityStore();
    let floor = await store.load();
    floor = updateRecoverySecurityFloor(floor, {
      installationEstablished: true,
      binding: targetBinding,
      recoveryState: 'RECOVERY_IN_PROGRESS',
      journal: {
        recoveryId: 'r3',
        commandId: '01991a00-0000-7000-8000-000000000709',
        backupId: '01991a00-0000-7000-8000-000000000707',
        artifactPath: 'artifact',
        phase: 'PREPARING',
        startedAt: new Date().toISOString(),
        originalDatabasePath: current,
        stagedDatabasePath: staged,
        stagedDatabaseSha256: snapshotHash(staged),
        nextRecoveryEpoch: 1,
        authorizationId: null,
        targetBinding: {
          tenantId: '01991a00-0000-7000-8000-000000000701',
          locationId: '01991a00-0000-7000-8000-000000000702',
          edgeId: '01991a00-0000-7000-8000-000000000703',
        },
        enteredFromRecoveryRequired: true,
      },
    });
    await store.save(floor);
    expect(await completePendingRecoveryAtStartup({ dbPath: current, store })).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(await store.load()).toMatchObject({
      recoveryState: 'RECOVERY_REQUIRED',
      journal: { recoveryId: 'r3', phase: 'PREPARING' },
      pendingRecoveryFailure: {
        commandId: '01991a00-0000-7000-8000-000000000709',
        backupId: '01991a00-0000-7000-8000-000000000707',
      },
    });
    await expect(stat(current)).resolves.toBeDefined();
    await expect(stat(`${current}.pre-recovery-r3`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
