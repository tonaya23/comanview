import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EntityId } from '@comanview/domain';
import { BASE_ROLE_PERMISSIONS, hashOperationalPin } from '@comanview/auth';
import { buildApp } from '../../index.js';
import { verifyAcceptanceOwner } from '../../phase1wAcceptanceLabCli.js';
import { inspectAdministrationSchema } from '@comanview/database';
import * as artifact from '../backup/BackupArtifact.js';
import { MemoryRecoverySecurityStore, initializeRecoverySecurityFloor } from '../backup/RecoverySecurityStore.js';
import { prepareProductionAdministrationUpgrade } from './ProductionAdministrationUpgrade.js';
import { prepareProductionRecoveryUpgrade } from '../backup/ProductionRecoveryUpgrade.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@comanview/database/edge';
import { DeviceRepository,EdgeControlRepository,AuthRepository } from '@comanview/database';
import { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { DeviceService } from '../devices/DeviceService.js';
import { PersonnelService } from './PersonnelService.js';
import { AuthService } from '../auth/application/AuthService.js';
import { generateKeyPairSync } from 'node:crypto';
import { signInstallationAuthorization,hashPairingCode } from '@comanview/licensing';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const id=()=>EntityId.generate().toString();
async function fixture(withOwner=true){
  const root=await mkdtemp(join(tmpdir(),'comanview-upgrade-1w-'));roots.push(root);
  const dbPath=join(root,'edge.db'),db=new Database(dbPath),directory=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url));
  const binding={edgeId:id(),tenantId:id(),locationId:id()},credentialId=id(),ownerId=id(),pinHash=await hashOperationalPin('9876');
  try{
    for(const file of readdirSync(directory).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=14).sort())db.exec(readFileSync(join(directory,file),'utf8'));
    db.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,provisioning_state,credential_id) VALUES('PRIMARY',?,?,?,1,'ACTIVE',?)").run(binding.edgeId,binding.tenantId,binding.locationId,credentialId);
    db.prepare("INSERT OR REPLACE INTO installation_state(singleton_key,bootstrap_status,initial_owner_user_id) VALUES('PRIMARY',?,?)").run(withOwner?'COMPLETED':'PENDING',withOwner?ownerId:null);
    if(withOwner){db.prepare("INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES(?,?,?,'Owner','ACTIVE',?,1)").run(ownerId,binding.tenantId,binding.locationId,pinHash);
      db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name='OWNER'").run(ownerId);}
    const store=new MemoryRecoverySecurityStore();await initializeRecoverySecurityFloor({store,sqlite:db,binding});
    return {dbPath,store,binding,ownerId,pinHash,edgeSecretStore:{load:async()=>({active:{credentialId,credential:'fixture-only-credential-value-12345678'},pending:null}),save:async()=>{},hasPersistedState:async()=>true}};
  }finally{db.close();}
}
function inspect<T>(path:string,run:(db:Database.Database)=>T){const db=new Database(path,{readonly:true,fileMustExist:true});try{return run(db);}finally{db.close();}}

it('allows genuine first installation bootstrap through the ordinary device service, with protected owner revisions and normal login',async()=>{
  const f=await fixture(false);expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'UPGRADED'});
  const db=new Database(f.dbPath);
  try{
    const repository=drizzle(db,{schema}),keys=generateKeyPairSync('ed25519'),publicKeyring={test:keys.publicKey.export({format:'pem',type:'spki'}).toString()};
    const licensing=new EdgeLicenseManager(new EdgeControlRepository(repository),null,{enforcementEnabled:false,publicKeyring,pullIntervalMs:1000,maxBackoffMs:1000,checkpointIntervalMs:1000},f.binding);
    const personnel=new PersonnelService(db,f.store,licensing,publicKeyring),devices=new DeviceService(new DeviceRepository(repository),licensing,f.binding,publicKeyring,undefined,f.store,undefined,personnel);
    const deviceId=id(),credential='isolated-device-credential-value-12345678901234567890',pairing=devices.createPairing({deviceId,credential,deviceType:'POS',displayName:'First POS'});
    const now=new Date(),payload={formatVersion:1 as const,typ:'comanview-installation-authorization' as const,authorizationId:id(),...f.binding,pairingId:pairing.pairingId,
      pairingCodeHash:hashPairingCode(pairing.pairingId,pairing.pairingCode),deviceId,deviceType:'POS' as const,displayName:'First POS',initialOwnerId:f.ownerId,initialOwnerDisplayName:'First owner',
      issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()};
    const request={pairingId:pairing.pairingId,pairingCode:pairing.pairingCode,requestToken:pairing.requestToken,ownerPin:'4321',authorization:signInstallationAuthorization(payload,'test',keys.privateKey.export({format:'pem',type:'pkcs8'}).toString())};
    await devices.completeBootstrap(request);
    await devices.completeBootstrap(request);
    expect((await f.store.load()).personnel!.users[f.ownerId]).toEqual({credentialRevision:1,authorizationRevision:1,sessionRevision:1,pending:null});
    const auth=new AuthService(new AuthRepository(repository),f.binding.tenantId,f.binding.locationId,f.store);
    const login=await auth.login({deviceId,deviceCredential:credential,pin:'4321'});
    expect(login.user.roles).toEqual(['OWNER']);
    expect([...login.user.permissions].sort()).toEqual([...BASE_ROLE_PERMISSIONS.OWNER].sort());
    for(const [role,expected] of Object.entries(BASE_ROLE_PERMISSIONS)){
      const actual=db.prepare('SELECT rp.permission_code code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.name=?').all(role) as Array<{code:string}>;
      expect(actual.map(x=>x.code).sort()).toEqual([...expected].sort());
    }
    expect(()=>verifyAcceptanceOwner(db)).not.toThrow();
    const gate=await buildApp(f.dbPath,{recoverySecurityStore:f.store,edgeSecretStore:f.edgeSecretStore,
      startPrintWorker:false,startSyncWorker:false,startControlWorker:false});
    try{for(const url of ['/catalog/products','/administration'])expect((await gate.inject({url,headers:{authorization:`Bearer ${login.token}`}})).statusCode).toBe(200);}finally{await gate.close();}
    // Established grants remain deliberately restrictive even after a bootstrap retry/restart.
    db.prepare("DELETE FROM role_permissions WHERE permission_code='CATALOG_VIEW'").run();
    expect(()=>verifyAcceptanceOwner(db)).toThrow('ACCEPTANCE_LAB_OWNER_BASELINE_INCOMPLETE');
    const restricted=db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_code').all();
    await devices.completeBootstrap(request);
    expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'CURRENT'});
    expect(db.prepare('SELECT * FROM role_permissions ORDER BY role_id,permission_code').all()).toEqual(restricted);
    db.prepare("INSERT INTO permissions(code,description) VALUES('UNKNOWN_PERMISSION','unknown')").run();
    db.prepare("INSERT INTO role_permissions SELECT id,'UNKNOWN_PERMISSION' FROM roles WHERE name='OWNER'").run();
    const effective=(await auth.login({deviceId,deviceCredential:credential,pin:'4321'})).user.permissions;
    expect(effective).not.toContain('CATALOG_VIEW');
    expect(effective).not.toContain('UNKNOWN_PERMISSION');
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({n:1});
    expect(db.prepare('SELECT count(*) AS n FROM cash_registers').get()).toEqual({n:0});
  }finally{db.close();}
});

it('upgrades a real 1V database, preserves credentials, revokes legacy sessions, and restarts without re-baselining',async()=>{
  const f=await fixture();
  expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'UPGRADED'});
  expect(inspect(f.dbPath,inspectAdministrationSchema)).toBe(15);
  expect(inspect(f.dbPath,db=>db.prepare('SELECT pin_hash FROM users WHERE id=?').get(f.ownerId))).toEqual({pin_hash:f.pinHash});
  expect(inspect(f.dbPath,db=>db.prepare('SELECT confirmed FROM business_profiles WHERE location_id=?').get(f.binding.locationId))).toEqual({confirmed:0});
  expect(inspect(f.dbPath,db=>db.prepare('SELECT operational_timezone timezone,business_day_rollover rollover FROM operational_configuration WHERE location_id=?').get(f.binding.locationId)))
    .toEqual({timezone:null,rollover:null});
  const floor=await f.store.load();expect(floor.personnel?.initializationState).toBe('ACTIVE');expect(floor.administrationUpgradeJournal).toBeNull();
  expect(await prepareProductionRecoveryUpgrade(f)).toEqual({state:'CURRENT'});
  expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'CURRENT'});
  expect((await f.store.load()).checksum).toBe(floor.checksum);
});
it('aborts before migration on snapshot failure, retaining diagnostic evidence and safely retrying',async()=>{
  const f=await fixture(),spy=vi.spyOn(artifact,'createEncryptedBackupArtifact').mockRejectedValueOnce(new Error('disk failure'));
  expect((await prepareProductionAdministrationUpgrade(f)).state).toBe('RECOVERY_REQUIRED');
  expect(inspect(f.dbPath,inspectAdministrationSchema)).toBe(14);
  expect((await f.store.load()).personnel).toBeUndefined();expect((await f.store.load()).administrationUpgradeJournal?.phase).toBe('PREPARING');
  spy.mockRestore();expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'UPGRADED'});
});
it('resumes interruption after migration but before floor reservation',async()=>{
  const f=await fixture(),original=f.store.load.bind(f.store);let interrupted=false;
  const spy=vi.spyOn(f.store,'load').mockImplementation(async()=>{
    if(!interrupted&&inspect(f.dbPath,inspectAdministrationSchema)===15){interrupted=true;throw new Error('interruption');}return original();
  });
  expect((await prepareProductionAdministrationUpgrade(f)).state).toBe('RECOVERY_REQUIRED');spy.mockRestore();
  expect(inspect(f.dbPath,inspectAdministrationSchema)).toBe(15);
  expect((await f.store.load()).administrationUpgradeJournal?.phase).toBe('SNAPSHOT_READY');
  expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'UPGRADED'});
});
it('fails closed when the protected baseline snapshot no longer matches the existing users',async()=>{
  const f=await fixture();vi.spyOn(artifact,'createEncryptedBackupArtifact').mockRejectedValueOnce(new Error('interrupt'));
  await prepareProductionAdministrationUpgrade(f);vi.restoreAllMocks();
  const verify=artifact.verifyEncryptedBackupArtifact;
  const spy=vi.spyOn(artifact,'verifyEncryptedBackupArtifact').mockImplementation(async input=>{
    const result=await verify(input);const snapshot=new Database(result.stagedDatabasePath);
    try{snapshot.prepare("UPDATE users SET display_name='Altered'").run();}finally{snapshot.close();}return result;
  });
  expect(await prepareProductionAdministrationUpgrade(f)).toEqual({state:'RECOVERY_REQUIRED',code:'ADMINISTRATION_SOURCE_CHANGED'});
  spy.mockRestore();expect(inspect(f.dbPath,inspectAdministrationSchema)).toBe(14);
});
