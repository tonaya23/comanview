import Database from 'better-sqlite3';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { EntityId } from '@comanview/domain';
import {
  applyRecoveryUpgradeMigration,
  inspectRecoveryUpgradeSchema,
  recoveryUpgradeMigrationHash,
} from '@comanview/database';
import { createEncryptedBackupArtifact, verifyEncryptedBackupArtifact } from './BackupArtifact.js';
import {
  ensureRecoveryKey,
  initializeRecoverySecurityFloor,
  isDeviceRevokedByFloor,
  mergeRecoverySecurityMetadata,
  updateRecoverySecurityFloor,
  type RecoverySecurityFloor,
  type RecoverySecurityStore,
} from './RecoverySecurityStore.js';
import type { EdgeSecretStore } from '../provisioning/EdgeSecretStore.js';
import { reconcileLicenseDecision } from '../licensing/LicensingSecurity.js';

type Binding = { tenantId: string; locationId: string; edgeId: string };
type Identity = Binding & { credentialId: string | null; provisioningState: string; epoch: number };
export type UpgradeResult = {
  state: 'FIRST_BOOT' | 'CURRENT' | 'UPGRADED' | 'RECOVERY_REQUIRED';
  code?: string;
};

/** Runs before operational connections/workers. No Cloud, provisioning or dev seeding. */
export async function prepareProductionRecoveryUpgrade(input: {
  dbPath: string;
  store: RecoverySecurityStore;
  edgeSecretStore: EdgeSecretStore;
}): Promise<UpgradeResult> {
  let db: Database.Database | undefined;
  let floor: RecoverySecurityFloor | undefined;
  try {
    floor = await input.store.load();
    const evidence = await input.edgeSecretStore.hasPersistedState();
    const exists = await stat(input.dbPath)
      .then((s) => s.isFile())
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      });
    if (!exists) {
      if (
        !floor.installationEstablished &&
        !evidence &&
        !floor.upgradeJournal &&
        floor.recoveryState === 'NORMAL'
      )
        return { state: 'FIRST_BOOT' };
      throw new Error('UPGRADE_DATABASE_MISSING');
    }
    if (floor.recoveryState === 'RECOVERY_REQUIRED' || floor.journal)
      throw new Error('UPGRADE_SECURITY_STATE_UNAVAILABLE');
    // No create fallback, even if the path disappears between stat and open.
    const preflight = new Database(input.dbPath, { readonly: true, fileMustExist: true });
    let version: 13 | 14, identity: Identity;
    try {
      integrity(preflight);
      version = inspectRecoveryUpgradeSchema(preflight);
      identity = readIdentity(preflight, version);
      mergeRecoverySecurityMetadata(floor, preflight);
    } finally {
      preflight.close();
    }
    const binding: Binding = {
      tenantId: identity.tenantId,
      locationId: identity.locationId,
      edgeId: identity.edgeId,
    };
    if (floor.binding && !sameBinding(binding, floor.binding))
      throw new Error('UPGRADE_BINDING_MISMATCH');
    if (floor.installationEstablished && !floor.binding) throw new Error('UPGRADE_BINDING_MISSING');
    if (version === 13 && floor.minimumSchemaVersion === 14)
      throw new Error('UPGRADE_SCHEMA_DOWNGRADE');
    if (version === 14 && !floor.upgradeJournal) {
      if(floor.licenseDecision){
        const reconciled=new Database(input.dbPath,{fileMustExist:true});
        try{floor=await input.store.mutate(current=>{
          if(current.recoveryState!=='NORMAL'||current.journal||current.upgradeJournal)throw new Error('UPGRADE_SECURITY_STATE_UNAVAILABLE');
          reconciled.transaction(()=>reconcileLicenseDecision(reconciled,current))();return current;
        });}finally{reconciled.close();}
      }
      const current = new Database(input.dbPath, { readonly: true, fileMustExist: true });
      try {
        verifyFloor(current, floor, binding);
      } finally {
        current.close();
      }
      if (floor.minimumSchemaVersion !== 14)
        await input.store.save(updateRecoverySecurityFloor(floor, { minimumSchemaVersion: 14 }));
      return { state: 'CURRENT' };
    }
    if (identity.epoch !== 0 || floor.recoveryEpoch !== 0)
      throw new Error('UPGRADE_EPOCH_ROLLBACK');
    const secrets = await input.edgeSecretStore.load();
    if (
      !evidence ||
      !secrets.active ||
      !identity.credentialId ||
      secrets.active.credentialId !== identity.credentialId
    )
      throw new Error('UPGRADE_CREDENTIAL_BINDING_INVALID');
    const migrationHash = recoveryUpgradeMigrationHash();
    if (floor.upgradeJournal) {
      const j = floor.upgradeJournal;
      if (
        j.formatVersion !== 1 ||
        j.fromSchema !== 13 ||
        j.toSchema !== 14 ||
        j.migrationHash !== migrationHash ||
        resolve(j.databasePath) !== resolve(input.dbPath) ||
        !floor.recoveryKey ||
        floor.recoveryState !== 'RECOVERY_IN_PROGRESS' ||
        (version === 14 && j.phase !== 'SNAPSHOT_READY')
      )
        throw new Error('UPGRADE_JOURNAL_INVALID');
    } else if (version !== 13 || floor.recoveryState !== 'NORMAL')
      throw new Error('UPGRADE_JOURNAL_MISSING');

    db = new Database(input.dbPath, { fileMustExist: true, timeout: 1000 });
    db.pragma('foreign_keys=ON');
    // A reserved writer lock also excludes a still-running 1U writer during the
    // snapshot/migration. Backup uses a separate read-only connection (WAL safe).
    db.exec('BEGIN IMMEDIATE');
    integrity(db);
    if (
      inspectRecoveryUpgradeSchema(db) !== version ||
      !sameBinding(readIdentity(db, version), binding)
    )
      throw new Error('UPGRADE_DATABASE_CHANGED');
    // Re-read protected state after acquiring the lock: concurrent startup must
    // never overwrite another process's completed floor with a stale copy.
    const lockedFloor = await input.store.load();
    if (lockedFloor.checksum !== floor.checksum) throw new Error('UPGRADE_CONCURRENT_STARTUP');
    if (!floor.upgradeJournal) {
      const snapshotId = EntityId.generate().toString();
      floor = ensureRecoveryKey(floor).floor;
      floor = updateRecoverySecurityFloor(floor, {
        installationEstablished: true,
        binding,
        recoveryState: 'RECOVERY_IN_PROGRESS',
        upgradeJournal: {
          formatVersion: 1,
          fromSchema: 13,
          toSchema: 14,
          phase: 'PREPARING',
          databasePath: resolve(input.dbPath),
          snapshotId,
          snapshotPath: join(
            dirname(resolve(input.dbPath)),
            '.upgrade-1v',
            `${snapshotId}.cvbackup`,
          ),
          migrationHash,
        },
      });
      await input.store.save(floor);
    }
    let journal = floor.upgradeJournal!;
    if (journal.phase === 'PREPARING') {
      // Unique attempt IDs preserve incomplete artifacts for diagnostics; they
      // are never mistaken for a verified safety snapshot on restart.
      const snapshotId = EntityId.generate().toString();
      journal = {
        ...journal,
        snapshotId,
        snapshotPath: join(dirname(resolve(input.dbPath)), '.upgrade-1v', `${snapshotId}.cvbackup`),
      };
      floor = updateRecoverySecurityFloor(floor, { upgradeJournal: journal });
      await input.store.save(floor);
      const source = new Database(input.dbPath, { readonly: true, fileMustExist: true });
      try {
        await createEncryptedBackupArtifact({
          source,
          destinationDirectory: dirname(journal.snapshotPath),
          backupId: snapshotId,
          binding: { ...binding, recoveryEpoch: 0 },
          recoveryKey: floor.recoveryKey!,
          trigger: 'SAFETY',
          destinationType: 'LOCAL',
          businessDate: null,
          schemaVersion: 13,
        });
      } finally {
        source.close();
      }
      journal = { ...journal, phase: 'SNAPSHOT_READY' };
      floor = updateRecoverySecurityFloor(floor, { upgradeJournal: journal });
      await input.store.save(floor);
    }
    const snapshot = await verifyEncryptedBackupArtifact({
      artifactPath: journal.snapshotPath,
      recoveryKey: floor.recoveryKey!,
      expectedBackupId: journal.snapshotId,
      expectedBinding: { ...binding, recoveryEpoch: 0 },
      allowLegacyUpgradeSnapshot: true,
    });
    try {
      if (snapshot.manifest.schemaVersion !== 13) throw new Error('UPGRADE_SNAPSHOT_INVALID');
      const baseline = new Database(snapshot.stagedDatabasePath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        if (inspectRecoveryUpgradeSchema(baseline) !== 13)
          throw new Error('UPGRADE_SNAPSHOT_INVALID');
        assertPreservedData(baseline, db);
        floor = mergeRecoverySecurityMetadata(floor, baseline);
      } finally {
        baseline.close();
      }
    } finally {
      await snapshot.cleanup();
    }
    if (version === 13) applyRecoveryUpgradeMigration(db);
    integrity(db);
    // Migration is durably committed before floor initialization. The protected
    // SNAPSHOT_READY journal authorizes exactly this resume window on restart.
    db.exec('COMMIT');
    db.exec('BEGIN IMMEDIATE');
    if (inspectRecoveryUpgradeSchema(db) !== 14) throw new Error('UPGRADE_SCHEMA_INVALID');
    await input.store.save(floor);
    floor = await initializeRecoverySecurityFloor({ store: input.store, sqlite: db, binding });
    mergeFloorIntoDatabase(db, floor);
    verifyFloor(db, floor, binding, true);
    db.exec('COMMIT');
    const finished = updateRecoverySecurityFloor(floor, {
      upgradeJournal: null,
      recoveryState: 'NORMAL',
      minimumSchemaVersion: 14,
    });
    await input.store.save(finished);
    // Verify persisted state, not just the object passed to save().
    verifyFloor(db, await input.store.load(), binding);
    return { state: 'UPGRADED' };
  } catch (error) {
    // Keep an interrupted journal intact for retry. Never fabricate a replacement
    // anchor after read/DPAPI failures or turn incomplete state into NORMAL.
    const message = error instanceof Error ? error.message : '';
    return {
      state: 'RECOVERY_REQUIRED',
      code: /^UPGRADE_[A-Z_]+$/.test(message) ? message : 'UPGRADE_FAILED',
    };
  } finally {
    if (db) {
      if (db.inTransaction) db.exec('ROLLBACK');
      db.close();
    }
  }
}

function integrity(db: Database.Database) {
  const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (
    rows.length !== 1 ||
    rows[0]?.integrity_check !== 'ok' ||
    (db.pragma('foreign_key_check') as unknown[]).length !== 0
  )
    throw new Error('UPGRADE_DATABASE_INVALID');
}
function readIdentity(db: Database.Database, version: 13 | 14): Identity {
  const count = db.prepare('SELECT COUNT(*) n FROM edge_installations').get() as { n: number };
  if (
    count.n !== 1 ||
    !db.prepare("SELECT 1 FROM installation_state WHERE singleton_key='PRIMARY'").get()
  )
    throw new Error('UPGRADE_INSTALLATION_INVALID');
  const rows = db
    .prepare(
      `SELECT tenant_id tenantId,location_id locationId,edge_id edgeId,
    credential_id credentialId,provisioning_state provisioningState,${version === 13 ? '0' : 'recovery_epoch'} epoch
    FROM edge_installations WHERE singleton_key='PRIMARY'`,
    )
    .all() as Identity[];
  const row = rows[0];
  if (rows.length !== 1 || !row || row.provisioningState !== 'ACTIVE')
    throw new Error('UPGRADE_INSTALLATION_INVALID');
  for (const id of [row.tenantId, row.locationId, row.edgeId]) EntityId.fromString(id);
  if (!Number.isSafeInteger(row.epoch) || row.epoch < 0) throw new Error('UPGRADE_EPOCH_INVALID');
  return row;
}
function sameBinding(a: Binding, b: Binding) {
  return a.edgeId === b.edgeId && a.tenantId === b.tenantId && a.locationId === b.locationId;
}

function verifyFloor(
  db: Database.Database,
  floor: RecoverySecurityFloor,
  binding: Binding,
  pending = false,
) {
  integrity(db);
  if (
    inspectRecoveryUpgradeSchema(db) !== 14 ||
    !floor.installationEstablished ||
    !floor.binding ||
    !sameBinding(binding, floor.binding) ||
    !floor.recoveryKey ||
    floor.journal ||
    (!pending && (floor.recoveryState !== 'NORMAL' || floor.upgradeJournal)) ||
    readIdentity(db, 14).epoch !== floor.recoveryEpoch
  )
    throw new Error('UPGRADE_FLOOR_INVALID');
  const runtime = db
    .prepare(
      "SELECT sticky_declared_state sticky FROM edge_control_runtime WHERE singleton_key='PRIMARY'",
    )
    .get() as { sticky: string | null } | undefined;
  if (
    !runtime ||
    (floor.stickyDeclaredState === 'TERMINATED' && runtime.sticky !== 'TERMINATED') ||
    (floor.stickyDeclaredState === 'SUSPENDED' &&
      !['SUSPENDED', 'TERMINATED'].includes(runtime.sticky ?? '')) ||
    (runtime.sticky === 'TERMINATED' && floor.stickyDeclaredState !== 'TERMINATED') ||
    (runtime.sticky === 'SUSPENDED' && !floor.stickyDeclaredState)
  )
    throw new Error('UPGRADE_LICENSING_INVALID');
  const docs = db
    .prepare('SELECT document_type type,revision,is_current current FROM edge_control_documents')
    .all() as Array<{
    type: keyof RecoverySecurityFloor['maximumSignedRevisions'];
    revision: number;
    current: number;
  }>;
  for (const doc of docs)
    if (
      (doc.revision > floor.maximumSignedRevisions[doc.type]&&
        !(doc.type==='LICENSE'&&!doc.current&&(floor.licenseDecision||floor.licensePending))) ||
      (doc.current && doc.revision < floor.maximumSignedRevisions[doc.type])
    )
      throw new Error('UPGRADE_REVISION_INVALID');
  const devices = db.prepare('SELECT id,status FROM devices').all() as Array<{
    id: string;
    status: string;
  }>;
  for (const device of devices)
    if ((device.status === 'REVOKED') !== isDeviceRevokedByFloor(floor, device.id))
      throw new Error('UPGRADE_REVOCATION_INVALID');
  // Prepare/read the structures required by 1V before operational repositories.
  db.prepare('SELECT recovery_epoch FROM event_log LIMIT 1').get();
  if (
    db
      .prepare(
        "SELECT 1 FROM event_log WHERE typeof(recovery_epoch)!='integer' OR recovery_epoch<0 OR recovery_epoch>? LIMIT 1",
      )
      .get(floor.recoveryEpoch)
  )
    throw new Error('UPGRADE_EPOCH_INVALID');
  db.prepare('SELECT * FROM backup_records LIMIT 1').get();
  if (!db.prepare("SELECT * FROM backup_runtime WHERE singleton_key='PRIMARY'").get())
    throw new Error('UPGRADE_RUNTIME_INVALID');
}
function mergeFloorIntoDatabase(db: Database.Database, floor: RecoverySecurityFloor) {
  const devices = db.prepare('SELECT id FROM devices').all() as Array<{ id: string }>;
  for (const d of devices)
    if (isDeviceRevokedByFloor(floor, d.id)) {
      db.prepare(
        "UPDATE devices SET status='REVOKED',revoked_at=COALESCE(revoked_at,?) WHERE id=? AND status!='REVOKED'",
      ).run(Date.now(), d.id);
      db.prepare(
        'UPDATE device_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=?',
      ).run(Date.now(), d.id);
      db.prepare(
        'UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=?',
      ).run(Date.now(), d.id);
    }
  db.prepare(
    `UPDATE edge_control_runtime SET sticky_declared_state=CASE
    WHEN ?='TERMINATED' OR sticky_declared_state='TERMINATED' THEN 'TERMINATED'
    WHEN ?='SUSPENDED' THEN 'SUSPENDED' ELSE sticky_declared_state END WHERE singleton_key='PRIMARY'`,
  ).run(floor.stickyDeclaredState, floor.stickyDeclaredState);
  for (const [type, revision] of Object.entries(floor.maximumSignedRevisions))
    db.prepare(
      'UPDATE edge_control_documents SET is_current=0 WHERE document_type=? AND revision<?',
    ).run(type, revision);
}

// Compare legacy columns in operational tables, streaming rows rather than
// retaining a second operational model in the security journal. Permissions and
// security tables are deliberately excluded: their monotonic changes are verified separately.
function assertPreservedData(baseline: Database.Database, current: Database.Database) {
  const tables = baseline
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const security = new Set([
    'permissions',
    'role_permissions',
    'devices',
    'device_credentials',
    'auth_sessions',
    'edge_control_documents',
    'edge_control_runtime',
  ]);
  for (const { name } of tables) {
    if (security.has(name)) continue;
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    const columns = (baseline.pragma(`table_info(${quoted})`) as Array<{ name: string }>)
      .map((c) => '"' + c.name.replaceAll('"', '""') + '"')
      .join(',');
    const sql = `SELECT ${columns} FROM ${quoted} ORDER BY rowid`;
    const a = baseline.prepare(sql).iterate(),
      b = current.prepare(sql).iterate();
    for (const row of a) {
      const next = b.next();
      if (next.done || JSON.stringify(row) !== JSON.stringify(next.value))
        throw new Error('UPGRADE_SOURCE_CHANGED');
    }
    if (!b.next().done) throw new Error('UPGRADE_SOURCE_CHANGED');
  }
}
