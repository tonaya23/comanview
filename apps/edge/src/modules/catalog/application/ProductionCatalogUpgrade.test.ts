import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { inspectAdministrationSchema, validateCatalogBaseline } from '@comanview/database';
import * as artifact from '../../backup/BackupArtifact.js';
import { DevelopmentRecoverySecurityStore, initializeRecoverySecurityFloor, updateRecoverySecurityFloor } from '../../backup/RecoverySecurityStore.js';
import { prepareProductionAdministrationUpgrade } from '../../personnel/ProductionAdministrationUpgrade.js';
import { prepareProductionCatalogUpgrade } from './ProductionCatalogUpgrade.js';
import { assessStartupDatabase } from '../../backup/StartupRecoveryGuard.js';
import { scheduleEmergencyRecovery, completePendingRecoveryAtStartup } from '../../backup/RecoveryCoordinator.js';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function inspect<T>(path:string,run:(db:Database.Database)=>T){const db=new Database(path,{readonly:true,fileMustExist:true});try{return run(db);}finally{db.close();}}
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'cv-catalog-lifecycle-'));roots.push(root);
  const dbPath=join(root,'edge.db'),db=new Database(dbPath),floorPath=join(root,'floor.json');
  const directory=fileURLToPath(new URL('../../../../../../migrations/edge/',import.meta.url));
  const binding={edgeId:randomUUID(),tenantId:randomUUID(),locationId:randomUUID()},credentialId=randomUUID();
  const store=new DevelopmentRecoverySecurityStore(floorPath);
  try{
    for(const name of readdirSync(directory).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&Number(n.slice(0,4))<=14).sort())db.exec(readFileSync(join(directory,name),'utf8'));
    db.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,provisioning_state,credential_id) VALUES('PRIMARY',?,?,?,1,'ACTIVE',?)").run(binding.edgeId,binding.tenantId,binding.locationId,credentialId);
    await initializeRecoverySecurityFloor({store,sqlite:db,binding});
  }finally{db.close();}
  const input={root,dbPath,floorPath,store,binding,edgeSecretStore:{load:async()=>({active:{credentialId,credential:'test-only-credential-not-production'},pending:null}),save:async()=>{},hasPersistedState:async()=>true}};
  expect(await prepareProductionAdministrationUpgrade(input)).toEqual({state:'UPGRADED'});
  const legacy=new Database(dbPath);
  try{legacy.exec(`INSERT INTO categories(id,name,active) VALUES('legacy','Category',1);
    INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES('tax','Tax',800,'TAX_ADDED');
    INSERT INTO products(id,name,category_id,tax_profile_id,base_price_amount,base_price_currency,sku,version)
    VALUES('a','A',NULL,'tax',100,'MXN','  abc ',4),('b','B','legacy','tax',200,'MXN','ABC',7);
    DELETE FROM role_permissions WHERE permission_code='CATALOG_MANAGE';`);}finally{legacy.close();}
  return input;
}
const version=(path:string)=>inspect(path,db=>db.pragma('user_version',{simple:true}));
const catalog=(path:string)=>inspect(path,db=>({
  categories:db.prepare('SELECT * FROM categories ORDER BY id').all(),
  products:db.prepare('SELECT * FROM products ORDER BY id').all(),
  claims:db.prepare('SELECT * FROM catalog_sku_claims ORDER BY sku_key').all(),
  state:db.prepare('SELECT * FROM catalog_state').all(),
  receipts:db.prepare('SELECT * FROM catalog_command_receipts ORDER BY command_id').all(),
  grants:db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_code').all(),
}));

it('migrates 15→16 with a separate protected journal, preserves security, and restarts idempotently',async()=>{
  const f=await fixture(),before=await f.store.load();
  expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'UPGRADED'});
  const floor=await f.store.load();
  expect(floor).toMatchObject({minimumSchemaVersion:16,recoveryState:'NORMAL',catalogUpgradeJournal:null,personnel:before.personnel,binding:before.binding,recoveryEpoch:before.recoveryEpoch,recoveryKey:before.recoveryKey,maximumSignedRevisions:before.maximumSignedRevisions,revokedDeviceBloom:before.revokedDeviceBloom});
  expect(version(f.dbPath)).toBe(16);
  inspect(f.dbPath,validateCatalogBaseline);
  expect(catalog(f.dbPath).claims).toEqual([{sku_key:'ABC',product_id:null,state:'CONFLICT'}]);
  const unchanged=catalog(f.dbPath);
  expect(await assessStartupDatabase(f.dbPath,f.store,true,true)).toBe('NORMAL');
  expect(await prepareProductionCatalogUpgrade({...f,store:new DevelopmentRecoverySecurityStore(f.floorPath)})).toEqual({state:'CURRENT'});
  expect((await f.store.load()).checksum).toBe(floor.checksum);
  expect(catalog(f.dbPath)).toEqual(unchanged);
  await expect(f.store.save(updateRecoverySecurityFloor(floor,{minimumSchemaVersion:15}))).rejects.toThrow();
  expect(()=>inspect(f.dbPath,inspectAdministrationSchema)).toThrow(); // runtime/schema inspector limited to 15 fails closed
});

it.each(['snapshot','post-sql','post-floor'] as const)('retries safely after %s interruption with real store/CAS',async boundary=>{
  const f=await fixture();let hit=false;
  if(boundary==='snapshot')vi.spyOn(artifact,'createEncryptedBackupArtifact').mockRejectedValueOnce(new Error('disk unavailable'));
  else {const save=f.store.save.bind(f.store);vi.spyOn(f.store,'save').mockImplementation(async value=>{
    if(!hit&&value.catalogUpgradeJournal?.phase==='VALIDATED'){hit=true;if(boundary==='post-floor')await save(value);throw new Error('interruption');}await save(value);
  });}
  expect((await prepareProductionCatalogUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
  expect(version(f.dbPath)).toBe(boundary==='snapshot'?15:16);
  expect((await f.store.load()).recoveryState).toBe('RECOVERY_IN_PROGRESS');
  expect(await assessStartupDatabase(f.dbPath,f.store,true,true)).toBe('RECOVERY_REQUIRED');
  vi.restoreAllMocks();
  expect(await prepareProductionCatalogUpgrade({...f,store:new DevelopmentRecoverySecurityStore(f.floorPath)})).toEqual({state:'UPGRADED'});
  expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'CURRENT'});
  inspect(f.dbPath,validateCatalogBaseline);
});

it.each(['binding','partial','digest','rollback'] as const)('fails closed for %s without weakening the Floor',async kind=>{
  const f=await fixture();
  if(kind==='digest'){
    vi.spyOn(artifact,'createEncryptedBackupArtifact').mockRejectedValueOnce(new Error('interrupt'));
    await prepareProductionCatalogUpgrade(f);vi.restoreAllMocks();
    await f.store.mutate(current=>updateRecoverySecurityFloor(current,{catalogUpgradeJournal:{...current.catalogUpgradeJournal!,migrationHash:'0'.repeat(64)}}));
  }else if(kind==='rollback')await f.store.mutate(current=>updateRecoverySecurityFloor(current,{minimumSchemaVersion:16}));
  else {const db=new Database(f.dbPath);try{db.exec(kind==='partial'?'PRAGMA user_version=16':`UPDATE edge_installations SET tenant_id='${randomUUID()}'`);}finally{db.close();}}
  expect((await prepareProductionCatalogUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
  expect(version(f.dbPath)).toBe(kind==='partial'?16:15);
});

it('rejects stale schema writers and incompatible journal types without losing the durable schema floor',async()=>{
  const f=await fixture(),stale=await f.store.load();
  expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'UPGRADED'});
  const independent=new DevelopmentRecoverySecurityStore(f.floorPath);
  await expect(independent.save(updateRecoverySecurityFloor(stale,{minimumSchemaVersion:15}))).rejects.toThrow();
  expect((await independent.load()).minimumSchemaVersion).toBe(16);
  const floor=await independent.load();
  await expect(independent.save(updateRecoverySecurityFloor(floor,{recoveryState:'RECOVERY_IN_PROGRESS',catalogUpgradeJournal:{
    formatVersion:1,kind:'CATALOG_SCHEMA_15_TO_16',fromSchema:15,toSchema:16,phase:'PREPARING',databasePath:f.dbPath,
    snapshotId:randomUUID(),snapshotPath:join(f.root,'snapshot.cvbackup'),migrationHash:'0'.repeat(64),
    binding:{...f.binding,edgeId:randomUUID()},recoveryEpoch:floor.recoveryEpoch,
  }}))).rejects.toThrow();
  expect(await independent.load()).toEqual(floor);
});

it.each(['corrupt-floor','missing-floor','partial-policy','partial-generation'] as const)('never starts on %s',async kind=>{
  const f=await fixture();
  if(kind==='corrupt-floor')await writeFile(f.floorPath,'corrupt test anchor');
  else if(kind==='missing-floor')f.store=new DevelopmentRecoverySecurityStore(join(f.root,'absent-floor.json'));
  else {
    const save=f.store.save.bind(f.store);
    vi.spyOn(f.store,'save').mockImplementation(async value=>{
      if(value.catalogUpgradeJournal?.phase==='VALIDATED')throw new Error('interrupted before floor advancement');
      await save(value);
    });
    expect((await prepareProductionCatalogUpgrade(f)).state).toBe('RECOVERY_REQUIRED');vi.restoreAllMocks();
    const db=new Database(f.dbPath);try{db.exec(kind==='partial-policy'?"DELETE FROM role_permissions WHERE permission_code='CATALOG_IMPORT'":"UPDATE catalog_state SET generation=1");}finally{db.close();}
  }
  expect((await prepareProductionCatalogUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
  if(kind.startsWith('partial-'))expect((await f.store.load()).recoveryState).toBe('RECOVERY_IN_PROGRESS');
});

it.each([15,16] as const)('restores a real encrypted schema %s backup under Floor16 and completes only on schema16',async schema=>{
  const f=await fixture();
  if(schema===16)expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'UPGRADED'});
  if(schema===16){const current=new Database(f.dbPath);try{
    current.exec("UPDATE catalog_state SET generation=7; DELETE FROM role_permissions WHERE permission_code='CATALOG_IMPORT'");
    const commandId=randomUUID(),result={commandId,entityType:'CATEGORIES',entityId:null,version:null,catalogGeneration:7,recoveryEpoch:0,changed:false,entities:[]};
    current.prepare('INSERT INTO catalog_command_receipts VALUES(?,?,?,?,?,?,?,?)').run(commandId,f.binding.tenantId,f.binding.locationId,f.binding.edgeId,0,'0'.repeat(64),JSON.stringify(result),1);
  }finally{current.close();}}
  const originalCatalog=schema===16?catalog(f.dbPath):null;
  const before=await f.store.load(),backupId=randomUUID(),db=new Database(f.dbPath);
  let backup:Awaited<ReturnType<typeof artifact.createEncryptedBackupArtifact>>;
  try{backup=await artifact.createEncryptedBackupArtifact({source:db,destinationDirectory:join(f.root,'backups'),backupId,binding:{...f.binding,recoveryEpoch:0},recoveryKey:before.recoveryKey!,schemaVersion:schema,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});}finally{db.close();}
  if(schema===15)expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'UPGRADED'});
  await scheduleEmergencyRecovery({backupId,artifactPath:backup.artifactPath,recoveryKey:before.recoveryKey!,binding:f.binding,publicKeyring:{},securityStore:f.store,dbPath:f.dbPath,now:new Date(),commandId:randomUUID()});
  const save=f.store.save.bind(f.store);
  vi.spyOn(f.store,'save').mockImplementation(async value=>{
    expect(value.minimumSchemaVersion).toBe(16);
    if(value.recoveryState==='NORMAL')expect(version(f.dbPath)).toBe(16);
    await save(value);
  });
  const result=await completePendingRecoveryAtStartup(f);
  expect(result,(await f.store.load()).pendingRecoveryFailure?.code).toBe('COMPLETED');
  expect(await f.store.load()).toMatchObject({minimumSchemaVersion:16,recoveryEpoch:1,recoveryState:'NORMAL',journal:null});
  inspect(f.dbPath,validateCatalogBaseline);
  if(originalCatalog)expect(catalog(f.dbPath)).toEqual(originalCatalog);
  else {
    expect(catalog(f.dbPath).claims).toEqual([{sku_key:'ABC',product_id:null,state:'CONFLICT'}]);
    expect(inspect(f.dbPath,db=>db.prepare("SELECT id,category_id,tax_profile_id,version FROM products WHERE id='b'").get())).toEqual({id:'b',category_id:'legacy',tax_profile_id:'tax',version:7});
    expect(inspect(f.dbPath,db=>db.prepare('SELECT generation FROM catalog_state').get())).toEqual({generation:0});
  }
  expect(await prepareProductionCatalogUpgrade(f)).toEqual({state:'CURRENT'});
  expect(await completePendingRecoveryAtStartup(f)).toBe('NONE');
});
