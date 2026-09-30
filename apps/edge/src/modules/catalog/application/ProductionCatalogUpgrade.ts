import Database from 'better-sqlite3';
import { dirname, join, resolve } from 'node:path';
import { EntityId } from '@comanview/domain';
import { applyModifierVersionSchemaMigration, modifierVersionMigrationDigest, inspectModifierVersionSchema, validateModifierVersionSchema, applyModifierQuantitySchemaMigration, modifierQuantityMigrationDigest, inspectModifierQuantitySchema, validateModifierQuantitySchema, applyCatalogSchemaMigration, catalogMigrationDigest, inspectCatalogSchema, validateCatalogBaseline } from '@comanview/database';
import { createEncryptedBackupArtifact, verifyEncryptedBackupArtifact } from '../../backup/BackupArtifact.js';
import { updateRecoverySecurityFloor, type RecoverySecurityStore } from '../../backup/RecoverySecurityStore.js';
import { verifyFloor, type UpgradeResult } from '../../backup/ProductionRecoveryUpgrade.js';
import type { EdgeSecretStore } from '../../provisioning/EdgeSecretStore.js';

/** Same lifecycle protocol as prior upgrades; never authorizes a Personnel baseline.
 * The SQLite writer reservation spans snapshot and migration. A pending protected
 * journal keeps all operational startup blocked across the SQL/Floor commit gap.
 */
export async function prepareProductionCatalogUpgrade(input:{dbPath:string;store:RecoverySecurityStore;edgeSecretStore:EdgeSecretStore;targetSchema?:16|17|18}):Promise<UpgradeResult>{
  const target=input.targetSchema??16, from=target===18?17:target===17?16:15;
  const inspect=target===18?inspectModifierVersionSchema:target===17?inspectModifierQuantitySchema:inspectCatalogSchema;
  const digest=target===18?modifierVersionMigrationDigest:target===17?modifierQuantityMigrationDigest:catalogMigrationDigest;
  const validate=target===18?validateModifierVersionSchema:target===17?validateModifierQuantitySchema:validateCatalogBaseline;
  const migrate=target===18?applyModifierVersionSchemaMigration:target===17?applyModifierQuantitySchemaMigration:applyCatalogSchemaMigration;
  let db:Database.Database|undefined;
  try{
    let floor=await input.store.load();
    if(!floor.installationEstablished||!floor.binding||!floor.recoveryKey||floor.journal||floor.upgradeJournal||floor.administrationUpgradeJournal||
      floor.personnel?.initializationState!=='ACTIVE'||floor.recoveryState==='RECOVERY_REQUIRED')throw new Error('CATALOG_SECURITY_UNAVAILABLE');
    db=new Database(input.dbPath,{fileMustExist:true,timeout:1000});db.pragma('foreign_keys=ON');
    db.exec('BEGIN IMMEDIATE');
    const version=inspect(db);
    const binding=db.prepare("SELECT edge_id edgeId,tenant_id tenantId,location_id locationId FROM edge_installations WHERE singleton_key='PRIMARY'").get() as typeof floor.binding|undefined;
    if(!binding||binding.edgeId!==floor.binding.edgeId||binding.tenantId!==floor.binding.tenantId||binding.locationId!==floor.binding.locationId)
      throw new Error('CATALOG_BINDING_MISMATCH');
    let journal=floor.catalogUpgradeJournal;
    verifyFloor(db,floor,floor.binding,Boolean(journal));
    if(journal&&(journal.toSchema!==target||journal.fromSchema!==from||journal.migrationHash!==digest()||resolve(journal.databasePath)!==resolve(input.dbPath)||
      journal.recoveryEpoch!==floor.recoveryEpoch||journal.binding.edgeId!==floor.binding.edgeId||
      journal.binding.tenantId!==floor.binding.tenantId||journal.binding.locationId!==floor.binding.locationId||
      (version===target&&journal.phase==='PREPARING')||(version===from&&journal.phase==='VALIDATED')))
      throw new Error('CATALOG_JOURNAL_INVALID');
    if(!journal&&version===target){
      if(floor.minimumSchemaVersion!==target)throw new Error('CATALOG_UPGRADE_EVIDENCE_MISSING');
      validate(db);return {state:'CURRENT'};
    }
    if(version===from&&(floor.minimumSchemaVersion!==from))throw new Error('CATALOG_SCHEMA_DOWNGRADE');
    const identity=db.prepare("SELECT credential_id id FROM edge_installations WHERE singleton_key='PRIMARY'").get() as {id:string|null};
    const secret=await input.edgeSecretStore.load();
    if(!await input.edgeSecretStore.hasPersistedState()||!identity.id||secret.active?.credentialId!==identity.id)
      throw new Error('CATALOG_CREDENTIAL_BINDING_INVALID');
    if(!journal){
      if(floor.recoveryState!=='NORMAL')throw new Error('CATALOG_SECURITY_UNAVAILABLE');
      const snapshotId=EntityId.generate().toString();
      journal={...(target===18?{kind:'CATALOG_MODIFIER_VERSION_17_TO_18' as const,fromSchema:17 as const,toSchema:18 as const}:target===17?{kind:'CATALOG_MODIFIER_QUANTITY_16_TO_17' as const,fromSchema:16 as const,toSchema:17 as const}:{kind:'CATALOG_SCHEMA_15_TO_16' as const,fromSchema:15 as const,toSchema:16 as const}),formatVersion:1,phase:'PREPARING',
        databasePath:resolve(input.dbPath),snapshotId,snapshotPath:join(dirname(resolve(input.dbPath)),'.upgrade-catalog',`${snapshotId}.cvbackup`),
        migrationHash:digest(),binding:floor.binding,recoveryEpoch:floor.recoveryEpoch};
      floor=updateRecoverySecurityFloor(floor,{catalogUpgradeJournal:journal,recoveryState:'RECOVERY_IN_PROGRESS'});
      await input.store.save(floor);
    }
    if(journal.phase==='PREPARING'){
      // A failed snapshot is retained as evidence; a retry gets a new artifact ID.
      const snapshotId=EntityId.generate().toString();
      journal={...journal,snapshotId,snapshotPath:join(dirname(journal.snapshotPath),`${snapshotId}.cvbackup`)};
      floor=updateRecoverySecurityFloor(floor,{catalogUpgradeJournal:journal});await input.store.save(floor);
      const source=new Database(input.dbPath,{readonly:true,fileMustExist:true});
      try{await createEncryptedBackupArtifact({source,destinationDirectory:dirname(journal.snapshotPath),backupId:snapshotId,
        binding:{...floor.binding!,recoveryEpoch:floor.recoveryEpoch},recoveryKey:floor.recoveryKey!,schemaVersion:from,
        trigger:'SAFETY',destinationType:'LOCAL',businessDate:null});}finally{source.close();}
      journal={...journal,phase:'SNAPSHOT_READY'};floor=updateRecoverySecurityFloor(floor,{catalogUpgradeJournal:journal});await input.store.save(floor);
    }
    const snapshot=await verifyEncryptedBackupArtifact({artifactPath:journal.snapshotPath,recoveryKey:floor.recoveryKey!,
      expectedBackupId:journal.snapshotId,expectedBinding:{...floor.binding!,recoveryEpoch:floor.recoveryEpoch}});
    try{
      const before=new Database(snapshot.stagedDatabasePath,{readonly:true,fileMustExist:true});
      try{
        if(inspect(before)!==from)throw new Error('CATALOG_SNAPSHOT_INVALID');
        if(target>=17)assertQuantityPreserved(before,db);else assertPreserved(before,db,version as 15|16);
        if(version===from)migrate(db);
        validate(db);
        if(target>=17)assertQuantityPreserved(before,db);else assertPreserved(before,db,16);
      }
      finally{before.close();}
    }finally{await snapshot.cleanup();}
    validate(db);
    db.exec('COMMIT');
    verifyFloor(db,await input.store.load(),floor.binding!,true);
    journal={...journal,phase:'VALIDATED'};
    floor=updateRecoverySecurityFloor(floor,{catalogUpgradeJournal:journal,minimumSchemaVersion:target});await input.store.save(floor);
    validate(db);
    await input.store.mutate(current=>{
      if(current.catalogUpgradeJournal?.snapshotId!==journal!.snapshotId||current.catalogUpgradeJournal.phase!=='VALIDATED'||current.minimumSchemaVersion!==target)
        throw new Error('CATALOG_CONCURRENT_UPGRADE');
      return updateRecoverySecurityFloor(current,{catalogUpgradeJournal:null,recoveryState:'NORMAL'});
    });
    verifyFloor(db,await input.store.load(),floor.binding!);
    return {state:'UPGRADED'};
  }catch(error){const code=error instanceof Error?error.message:'';
    return {state:'RECOVERY_REQUIRED',code:/^(CATALOG_|MODIFIER_|UPGRADE_|RECOVERY_SECURITY_|SKU_)[A-Z_]+$/.test(code)?code:'CATALOG_UPGRADE_FAILED'};
  }finally{if(db){if(db.inTransaction)db.exec('ROLLBACK');db.close();}}
}

function assertPreserved(before:Database.Database,after:Database.Database,version:15|16){
  const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
  const system=version===16?(after.prepare("SELECT id FROM categories WHERE system_key='UNCATEGORIZED'").get() as {id:string}|undefined)?.id:null;
  for(const {name} of before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{name:string}>){
    const columns=(before.pragma(`table_info(${quote(name)})`) as Array<{name:string}>).map(c=>quote(c.name)).join(',');
    const query=`SELECT ${columns} FROM ${quote(name)}`;
    const original=before.prepare(query).all() as Array<Record<string,unknown>>;
    const actual=after.prepare(query).all() as Array<Record<string,unknown>>;
    const expected=original.map(row=>name==='products'&&version===16&&row['category_id']===null?{...row,category_id:system}:row);
    const filtered=actual.filter(row=>!(version===16&&((name==='categories'&&row['id']===system)||
      (name==='permissions'&&row['code']==='CATALOG_IMPORT'&&!original.some(old=>old['code']===row['code']))||
      (name==='role_permissions'&&row['permission_code']==='CATALOG_IMPORT'&&!original.some(old=>old['role_id']===row['role_id']&&old['permission_code']===row['permission_code'])))));
    const canonical=(rows:Array<Record<string,unknown>>)=>rows.map(row=>JSON.stringify(row)).sort();
    if(JSON.stringify(canonical(expected))!==JSON.stringify(canonical(filtered)))throw new Error('CATALOG_SOURCE_CHANGED');
  }
  if(version===16){
    if((after.prepare("SELECT generation FROM catalog_state WHERE singleton_key='PRIMARY'").get() as {generation:number}).generation!==0)
      throw new Error('CATALOG_BASELINE_INVALID');
    const expected=new Set((before.prepare("SELECT role_id id FROM role_permissions WHERE permission_code='CATALOG_IMPORT' UNION SELECT id FROM roles WHERE name IN ('OWNER','MANAGER')").all() as Array<{id:string}>).map(row=>row.id));
    const actual=(after.prepare("SELECT role_id id FROM role_permissions WHERE permission_code='CATALOG_IMPORT'").all() as Array<{id:string}>).map(row=>row.id);
    if(actual.length!==expected.size||actual.some(id=>!expected.has(id)))throw new Error('CATALOG_POLICY_INVALID');
  }
}


function assertQuantityPreserved(before:Database.Database,after:Database.Database){
  const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
  for(const {name} of before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>){
    const columns=(before.pragma(`table_info(${quote(name)})`) as Array<{name:string}>).map(c=>quote(c.name)).join(',');
    const query=`SELECT ${columns} FROM ${quote(name)}`;
    const canonical=(db:Database.Database)=>JSON.stringify(db.prepare(query).all().map(row=>JSON.stringify(row)).sort());
    if(canonical(before)!==canonical(after))throw new Error('CATALOG_SOURCE_CHANGED');
  }
  if(before.pragma('user_version',{simple:true})===16&&after.pragma('user_version',{simple:true})===17&&after.prepare('SELECT 1 FROM order_item_modifiers WHERE quantity<>1 LIMIT 1').get())throw new Error('CATALOG_SOURCE_CHANGED');
  if(before.pragma('user_version',{simple:true})===17&&after.pragma('user_version',{simple:true})===18)
    for(const table of ['modifier_groups','modifier_options'])
      if(after.prepare(`SELECT 1 FROM ${table} WHERE version<>1 LIMIT 1`).get())throw new Error('CATALOG_SOURCE_CHANGED');
}
