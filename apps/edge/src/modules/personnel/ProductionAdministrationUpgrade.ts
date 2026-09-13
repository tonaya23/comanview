import Database from 'better-sqlite3';
import { dirname, join, resolve } from 'node:path';
import { EntityId } from '@comanview/domain';
import { administrationMigrationDigest, applyAdministrationSchemaMigration, inspectAdministrationSchema,initializeLegacyAdministrationBaseline } from '@comanview/database';
import { createEncryptedBackupArtifact, verifyEncryptedBackupArtifact } from '../backup/BackupArtifact.js';
import { performPersonnelSecurityOperation, updateRecoverySecurityFloor, type RecoverySecurityStore } from '../backup/RecoverySecurityStore.js';
import { verifyFloor, type UpgradeResult } from '../backup/ProductionRecoveryUpgrade.js';
import type { EdgeSecretStore } from '../provisioning/EdgeSecretStore.js';

/** Called after the 1U -> 1V guard, before repositories, sockets or workers.
 * The protected journal authorizes baseline enrollment only for this exact upgrade.
 * A restored 1V database has no such journal and must never receive a new baseline.
 */
export async function prepareProductionAdministrationUpgrade(input:{dbPath:string;store:RecoverySecurityStore;edgeSecretStore:EdgeSecretStore}):Promise<UpgradeResult>{
  let db:Database.Database|undefined;
  try{
    let floor=await input.store.load();
    if(!floor.installationEstablished||!floor.binding||!floor.recoveryKey||floor.journal||floor.upgradeJournal||floor.recoveryState==='RECOVERY_REQUIRED')
      throw new Error('ADMINISTRATION_SECURITY_UNAVAILABLE');
    const preflight=new Database(input.dbPath,{readonly:true,fileMustExist:true});
    let version:14|15;
    try{
      version=inspectAdministrationSchema(preflight);
      verifyFloor(preflight,floor,floor.binding,Boolean(floor.administrationUpgradeJournal));
      if(version===14&&floor.personnel&&!floor.administrationUpgradeJournal)throw new Error('ADMINISTRATION_SCHEMA_DOWNGRADE');
      if(version===15&&!floor.administrationUpgradeJournal){
        if(floor.minimumSchemaVersion!==15||floor.personnel?.initializationState!=='ACTIVE')throw new Error('PERSONNEL_BASELINE_NOT_AUTHORIZED');
        return {state:'CURRENT'};
      }
      const identity=preflight.prepare("SELECT credential_id AS id FROM edge_installations WHERE singleton_key='PRIMARY'").get() as {id:string|null};
      const secrets=await input.edgeSecretStore.load();
      if(!await input.edgeSecretStore.hasPersistedState()||!identity.id||secrets.active?.credentialId!==identity.id)
        throw new Error('ADMINISTRATION_CREDENTIAL_BINDING_INVALID');
    }finally{preflight.close();}
    let journal=floor.administrationUpgradeJournal;
    if(journal&&(journal.migrationHash!==administrationMigrationDigest()||resolve(journal.databasePath)!==resolve(input.dbPath)||
      (version===15&&journal.phase!=='SNAPSHOT_READY')))throw new Error('ADMINISTRATION_JOURNAL_INVALID');
    db=new Database(input.dbPath,{fileMustExist:true,timeout:1000});db.pragma('foreign_keys=ON');
    db.exec('BEGIN IMMEDIATE');
    if(inspectAdministrationSchema(db)!==version||(await input.store.load()).checksum!==floor.checksum)
      throw new Error('ADMINISTRATION_CONCURRENT_STARTUP');
    if(!journal){
      if(version!==14||floor.personnel||floor.minimumSchemaVersion===15||floor.recoveryState!=='NORMAL')throw new Error('PERSONNEL_BASELINE_NOT_AUTHORIZED');
      const snapshotId=EntityId.generate().toString();
      journal={formatVersion:1,fromSchema:14,toSchema:15,phase:'PREPARING',databasePath:resolve(input.dbPath),snapshotId,
        snapshotPath:join(dirname(resolve(input.dbPath)),'.upgrade-1w',`${snapshotId}.cvbackup`),migrationHash:administrationMigrationDigest()};
      floor=updateRecoverySecurityFloor(floor,{recoveryState:'RECOVERY_IN_PROGRESS',administrationUpgradeJournal:journal});
      await input.store.save(floor);
    }
    if(journal.phase==='PREPARING'){
      const snapshotId=EntityId.generate().toString();
      journal={...journal,snapshotId,snapshotPath:join(dirname(resolve(input.dbPath)),'.upgrade-1w',`${snapshotId}.cvbackup`)};
      floor=updateRecoverySecurityFloor(floor,{administrationUpgradeJournal:journal});await input.store.save(floor);
      const source=new Database(input.dbPath,{readonly:true,fileMustExist:true});
      try{await createEncryptedBackupArtifact({source,destinationDirectory:dirname(journal.snapshotPath),backupId:snapshotId,
        binding:{...floor.binding!,recoveryEpoch:floor.recoveryEpoch},recoveryKey:floor.recoveryKey!,trigger:'SAFETY',destinationType:'LOCAL',businessDate:null,schemaVersion:14});}
      finally{source.close();}
      journal={...journal,phase:'SNAPSHOT_READY'};
      floor=updateRecoverySecurityFloor(floor,{administrationUpgradeJournal:journal});await input.store.save(floor);
    }
    const snapshot=await verifyEncryptedBackupArtifact({artifactPath:journal.snapshotPath,recoveryKey:floor.recoveryKey!,
      expectedBackupId:journal.snapshotId,expectedBinding:{...floor.binding!,recoveryEpoch:floor.recoveryEpoch}});
    try{
      const baseline=new Database(snapshot.stagedDatabasePath,{readonly:true,fileMustExist:true});
      try{if(inspectAdministrationSchema(baseline)!==14)throw new Error('ADMINISTRATION_SNAPSHOT_INVALID');assertPreserved(baseline,db);}
      finally{baseline.close();}
    }finally{await snapshot.cleanup();}
    if(version===14){applyAdministrationSchemaMigration(db);initializeLegacyAdministrationBaseline(db,floor.binding!);}
    db.exec('COMMIT');
    if(floor.personnel?.initializationState!=='ACTIVE')await performPersonnelSecurityOperation(input.store,{kind:'BASELINE',sqlite:db});
    floor=await input.store.load();
    verifyFloor(db,floor,floor.binding!,true);
    if(inspectAdministrationSchema(db)!==15||floor.personnel?.initializationState!=='ACTIVE')throw new Error('ADMINISTRATION_VALIDATION_FAILED');
    await input.store.mutate(current=>{
      if(current.administrationUpgradeJournal?.snapshotId!==journal!.snapshotId||current.personnel?.initializationState!=='ACTIVE')
        throw new Error('ADMINISTRATION_CONCURRENT_STARTUP');
      return updateRecoverySecurityFloor(current,{administrationUpgradeJournal:null,minimumSchemaVersion:15,recoveryState:'NORMAL'});
    });
    verifyFloor(db,await input.store.load(),floor.binding!);
    return {state:'UPGRADED'};
  }catch(error){const code=error instanceof Error?error.message:'';
    return {state:'RECOVERY_REQUIRED',code:/^(ADMINISTRATION_|PERSONNEL_)[A-Z_]+$/.test(code)?code:'ADMINISTRATION_UPGRADE_FAILED'};
  }finally{if(db){if(db.inTransaction)db.exec('ROLLBACK');db.close();}}
}

function assertPreserved(before:Database.Database,after:Database.Database){
  // Compare original operational columns. Migration-only grants/session revocation
  // are verified separately by the personnel baseline. No operational copy in floor.
  for(const {name} of before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>){
    if(['permissions','role_permissions','auth_sessions'].includes(name))continue;
    const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
    const columns=(before.pragma(`table_info(${quote(name)})`) as Array<{name:string}>).map(c=>quote(c.name)).join(',');
    const statement=`SELECT ${columns} FROM ${quote(name)} ORDER BY rowid`;
    const old=before.prepare(statement).iterate(),fresh=after.prepare(statement).iterate();
    try{
      for(const row of old){const next=fresh.next();if(next.done||JSON.stringify(row)!==JSON.stringify(next.value))throw new Error('ADMINISTRATION_SOURCE_CHANGED');}
      if(!fresh.next().done)throw new Error('ADMINISTRATION_SOURCE_CHANGED');
    }finally{old.return?.();fresh.return?.();}
  }
}
