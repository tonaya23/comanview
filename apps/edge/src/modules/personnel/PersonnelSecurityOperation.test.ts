import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EntityId } from '@comanview/domain';
import { hashOperationalPin, verifyOperationalPin, hashDeviceCredential } from '@comanview/auth';
import { AuthRepository,EdgeControlRepository, applyAdministrationSchemaMigration, administrationMigrationDigest } from '@comanview/database';
import { generateKeyPairSync } from 'node:crypto';
import { signOwnerRecoveryAuthorization } from '@comanview/licensing';
import { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@comanview/database/edge';
import { AuthService } from '../auth/application/AuthService.js';
import { MemoryRecoverySecurityStore, ensureRecoveryKey, performPersonnelSecurityOperation, updateRecoverySecurityFloor } from '../backup/RecoverySecurityStore.js';
import { createEncryptedBackupArtifact } from '../backup/BackupArtifact.js';
import { personnelRestrictions, type StoredPersonnelSecurity } from './PersonnelSecurityModel.js';
import type { PersonnelMutation } from './PersonnelSecurityOperation.js';
import { scheduleEmergencyRecovery, completePendingRecoveryAtStartup } from '../backup/RecoveryCoordinator.js';
import { prepareProductionAdministrationUpgrade } from './ProductionAdministrationUpgrade.js';

const directory=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url));
const resources:Array<{root:string;db:Database.Database}>=[];
afterEach(async()=>{vi.restoreAllMocks();const owned=resources.splice(0);for(const r of owned)if(r.db.open)r.db.close();for(const root of new Set(owned.map(r=>r.root)))await rm(root,{recursive:true,force:true});});
const id=()=>EntityId.generate().toString();
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'comanview-personnel-')),db=new Database(join(root,'edge.db'));
  resources.push({root,db});
  for(const file of readdirSync(directory).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=14).sort())db.exec(readFileSync(join(directory,file),'utf8'));
  const binding={tenantId:id(),locationId:id(),edgeId:id()},ownerId=id(),workerId=id(),deviceId=id(),sessionId=id();
  const ownerHash=await hashOperationalPin('1111'),workerHash=await hashOperationalPin('2222');
  db.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)").run(binding.edgeId,binding.tenantId,binding.locationId);
  for(const name of ['OWNER','MANAGER','CASHIER','WAITER','KITCHEN'])db.prepare('INSERT OR IGNORE INTO roles(id,name) VALUES(?,?)').run(id(),name);
  for(const [userId,name,hash,role] of [[ownerId,'Owner',ownerHash,'OWNER'],[workerId,'Worker',workerHash,'WAITER']]){
    db.prepare("INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES(?,?,?,?,'ACTIVE',?,1)").run(userId,binding.tenantId,binding.locationId,name,hash);
    db.prepare('INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name=?').run(userId,role);
  }
  db.prepare("INSERT INTO devices(id,tenant_id,location_id,name,device_type,status,session_timeout_minutes,created_at) VALUES(?,?,?,'Device','POS','ACTIVE',60,1)").run(deviceId,binding.tenantId,binding.locationId);
  const deviceCredential='test-device-credential-not-for-production';
  db.prepare('INSERT INTO device_credentials(credential_id,device_id,credential_hash,created_at) VALUES(?,?,?,1)').run(id(),deviceId,hashDeviceCredential(deviceCredential));
  const store=new MemoryRecoverySecurityStore();
  await store.mutate(value=>updateRecoverySecurityFloor(ensureRecoveryKey(value).floor,{binding,installationEstablished:true,minimumSchemaVersion:14}));
  const snapshotId=id(),floor=await store.load();
  const artifact=await createEncryptedBackupArtifact({source:db,destinationDirectory:join(root,'safety'),backupId:snapshotId,
    binding:{...binding,recoveryEpoch:0},recoveryKey:floor.recoveryKey!,trigger:'SAFETY',destinationType:'LOCAL',businessDate:null,schemaVersion:14});
  await store.mutate(value=>updateRecoverySecurityFloor(value,{recoveryState:'RECOVERY_IN_PROGRESS',administrationUpgradeJournal:{formatVersion:1,
    fromSchema:14,toSchema:15,phase:'SNAPSHOT_READY',snapshotId,snapshotPath:artifact.artifactPath,databasePath:join(root,'edge.db'),migrationHash:administrationMigrationDigest()}}));
  applyAdministrationSchemaMigration(db);
  await performPersonnelSecurityOperation(store,{kind:'BASELINE',sqlite:db});
  await store.mutate(value=>updateRecoverySecurityFloor(value,{administrationUpgradeJournal:null,recoveryState:'NORMAL'}));
  const personnel=(await store.load()).personnel!;
  db.prepare(`INSERT INTO auth_sessions(id,user_id,device_id,tenant_id,location_id,token_hash,login_at,last_activity,expires_at,trust_domain_id,
    credential_revision,authorization_revision,session_revision,issued_recovery_epoch) VALUES(?,?,?,?,?,?,1,1,?,?,?,?,?,0)`)
    .run(sessionId,ownerId,deviceId,binding.tenantId,binding.locationId,'session-test',Date.now()+3600000,personnel.trustDomainId,1,1,1);
  const run=(command:Partial<PersonnelMutation>&Pick<PersonnelMutation,'kind'>)=>performPersonnelSecurityOperation(store,{kind:'MUTATE',sqlite:db,sessionId,
    command:{commandId:id(),userId:workerId,expectedVersion:1,reason:'Authorized test change',...command}});
  const row=()=>db.prepare(`SELECT id AS userId,status,trust_domain_id AS trustDomainId,credential_revision AS credentialRevision,
    authorization_revision AS authorizationRevision,pin_hash AS pinHash,version FROM users WHERE id=?`).get(workerId) as StoredPersonnelSecurity&{pinHash:string;version:number};
  const auth=new AuthService(new AuthRepository(drizzle(db,{schema})),binding.tenantId,binding.locationId,store);
  const login=(pin:string)=>auth.login({deviceId,deviceCredential,pin});
  return {root,db,store,binding,ownerId,workerId,sessionId,deviceId,deviceCredential,workerHash,run,row,auth,login};
}

describe('durable personnel security protocol',()=>{
  it('recovers only the Cloud-signed contractual owner with a new PIN, exact binding and one-use generation',async()=>{
    const f=await fixture(),floor=await f.store.load(),dbPath=f.db.name;
    const path=join(f.root,'safety',readdirSync(join(f.root,'safety')).find(name=>name.endsWith('.cvbackup'))!);
    const manifest=JSON.parse(readFileSync(join(path,'manifest.json'),'utf8')) as {backupId:string};f.db.close();
    await scheduleEmergencyRecovery({dbPath,securityStore:f.store,binding:f.binding,publicKeyring:{},backupId:manifest.backupId,artifactPath:path,
      recoveryKey:floor.recoveryKey!,commandId:id(),now:new Date()});
    expect(await completePendingRecoveryAtStartup({dbPath,store:f.store})).toBe('COMPLETED');
    const db=new Database(dbPath);resources.push({root:f.root,db});
    await performPersonnelSecurityOperation(f.store,{kind:'OWNER_CHALLENGE',sqlite:db,deviceId:f.deviceId,deviceCredential:f.deviceCredential,pairingId:null});
    const current=(await f.store.load()).personnel!,keys=generateKeyPairSync('ed25519'),publicKeyring={owner:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
    const payload={...current.recoveryContext!,tenantId:f.binding.tenantId,locationId:f.binding.locationId,trustDomainId:current.trustDomainId,
      ...current.ownerRecoveryAccess.challenge!,accessGeneration:current.ownerRecoveryAccess.generation,formatVersion:1 as const,
      typ:'comanview-owner-recovery-authorization' as const,purpose:'RESTORE_CONTRACTUAL_OWNER' as const,authorizationId:id(),ownerUserId:f.ownerId,
      issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
    const sign=(p:typeof payload)=>signOwnerRecoveryAuthorization(p,'owner',keys.privateKey.export({type:'pkcs8',format:'pem'}).toString());
    const licensing=new EdgeLicenseManager(new EdgeControlRepository(drizzle(db,{schema})),null,{enforcementEnabled:false,publicKeyring:{},pullIntervalMs:1000,maxBackoffMs:1000,checkpointIntervalMs:1000},f.binding);
    const request={commandId:id(),authorization:sign(payload),newPin:'5555',deviceCredential:f.deviceCredential};
    await expect(performPersonnelSecurityOperation(f.store,{kind:'RECOVER_OWNER',sqlite:db,request:{...request,authorization:sign({...payload,locationId:id()})},publicKeyring,licensing})).rejects.toThrow('OWNER_RECOVERY_BINDING_INVALID');
    await expect(performPersonnelSecurityOperation(f.store,{kind:'RECOVER_OWNER',sqlite:db,request:{...request,newPin:'1111'},publicKeyring,licensing})).rejects.toThrow('PERSONNEL_NEW_PIN_REQUIRED');
    await performPersonnelSecurityOperation(f.store,{kind:'RECOVER_OWNER',sqlite:db,request,publicKeyring,licensing});
    await performPersonnelSecurityOperation(f.store,{kind:'RECOVER_OWNER',sqlite:db,request,publicKeyring,licensing});
    await expect(performPersonnelSecurityOperation(f.store,{kind:'RECOVER_OWNER',sqlite:db,request:{...request,commandId:id()},publicKeyring,licensing})).rejects.toThrow('OWNER_RECOVERY_AUTHORIZATION_CONSUMED');
    const auth=new AuthService(new AuthRepository(drizzle(db,{schema})),f.binding.tenantId,f.binding.locationId,f.store);
    expect((await auth.login({deviceId:f.deviceId,deviceCredential:f.deviceCredential,pin:'5555'})).user.roles).toEqual(['OWNER']);
    await expect(auth.login({deviceId:f.deviceId,deviceCredential:f.deviceCredential,pin:'2222'})).rejects.toMatchObject({code:'USER_UNTRUSTED'});
    expect((await f.store.load()).recoveryEpoch).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM owner_recovery_acknowledgements').get()).toEqual({n:1});
  });
  it('restores an older personnel snapshot selectively without reviving a rotated PIN, roles, or sessions',async()=>{
    const f=await fixture(),backupId=id(),before=await f.login('2222'),floor=await f.store.load();
    const backup=await createEncryptedBackupArtifact({source:f.db,destinationDirectory:join(f.root,'restore-test'),backupId,
      binding:{...f.binding,recoveryEpoch:0},recoveryKey:floor.recoveryKey!,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});
    await f.run({kind:'ROTATE_CREDENTIAL',newPin:'3333'});
    await f.run({kind:'CHANGE_AUTHORIZATION',roles:['CASHIER'],expectedVersion:2});
    const current=await f.store.load(),dbPath=f.db.name;f.db.close();
    await scheduleEmergencyRecovery({dbPath,securityStore:f.store,binding:f.binding,publicKeyring:{},backupId,artifactPath:backup.artifactPath,
      recoveryKey:floor.recoveryKey!,commandId:id(),now:new Date()});
    expect(await completePendingRecoveryAtStartup({dbPath,store:f.store})).toBe('COMPLETED');
    const db=new Database(dbPath);resources.push({root:f.root,db});
    const auth=new AuthService(new AuthRepository(drizzle(db,{schema})),f.binding.tenantId,f.binding.locationId,f.store);
    const restored=db.prepare(`SELECT id AS userId,status,trust_domain_id AS trustDomainId,credential_revision AS credentialRevision,
      authorization_revision AS authorizationRevision FROM users WHERE id=?`).get(f.workerId) as StoredPersonnelSecurity;
    expect(personnelRestrictions((await f.store.load()).personnel!,restored)).toEqual(['CREDENTIAL_RESET_REQUIRED','USER_REVIEW_REQUIRED']);
    expect((await f.store.load()).personnel!.users).toEqual(current.personnel!.users);
    expect(auth.isTokenAuthorized(before.token,'OWN_PIN_CHANGE')).toBe(false);
    const owner=db.prepare('SELECT credential_revision AS c,authorization_revision AS a FROM users WHERE id=?').get(f.ownerId);
    expect(owner).toEqual({c:1,a:1});expect((await f.store.load()).recoveryState).toBe('NORMAL');
  });
  it('migrates an authenticated legacy backup structurally but never runs the personnel baseline after restore',async()=>{
    const f=await fixture(),floor=await f.store.load(),dbPath=f.db.name;
    const path=join(f.root,'safety',readdirSync(join(f.root,'safety')).find(name=>name.endsWith('.cvbackup'))!);
    const manifest=JSON.parse(readFileSync(join(path,'manifest.json'),'utf8')) as {backupId:string};f.db.close();
    await scheduleEmergencyRecovery({dbPath,securityStore:f.store,binding:f.binding,publicKeyring:{},backupId:manifest.backupId,artifactPath:path,
      recoveryKey:floor.recoveryKey!,commandId:id(),now:new Date()});
    expect(await completePendingRecoveryAtStartup({dbPath,store:f.store})).toBe('COMPLETED');
    const db=new Database(dbPath);resources.push({root:f.root,db});
    expect(db.pragma('user_version',{simple:true})).toBe(15);
    expect(db.prepare('SELECT trust_domain_id FROM users WHERE id=?').get(f.ownerId)).toEqual({trust_domain_id:null});
    expect((await f.store.load()).personnel!.trustDomainId).toBe(floor.personnel!.trustDomainId);
    expect(await prepareProductionAdministrationUpgrade({dbPath,store:f.store,edgeSecretStore:{load:async()=>({active:null,pending:null}),hasPersistedState:async()=>false,save:async()=>{}}})).toEqual({state:'CURRENT'});
    // Structural startup is normal, but no legacy credential is promoted.
    expect(db.prepare('SELECT trust_domain_id FROM users WHERE id=?').get(f.ownerId)).toEqual({trust_domain_id:null});
  });
  it('checks login, ordinary sessions and override against current personnel revisions and restore epoch',async()=>{
    const f=await fixture(),first=await f.login('2222');
    expect(f.auth.authenticate(first.token).userId).toBe(f.workerId);
    await f.run({kind:'ROTATE_CREDENTIAL',newPin:'3333'});
    expect(f.auth.isTokenAuthorized(first.token,'OWN_PIN_CHANGE')).toBe(false);
    await expect(f.login('2222')).rejects.toThrow('Invalid operational PIN');
    const second=await f.login('3333');
    expect(f.auth.authenticate(second.token).userId).toBe(f.workerId);
    f.db.prepare('UPDATE users SET pin_hash=?,credential_revision=1 WHERE id=?').run(f.workerHash,f.workerId);
    await expect(f.login('2222')).rejects.toMatchObject({code:'CREDENTIAL_RESET_REQUIRED'});
    expect(f.auth.isTokenAuthorized(second.token,'OWN_PIN_CHANGE')).toBe(false);
    await f.run({kind:'ROTATE_CREDENTIAL',expectedVersion:2,newPin:'4444'});
    const restored=await f.login('4444'),actor=f.auth.authenticate(restored.token);
    await f.run({kind:'CHANGE_AUTHORIZATION',userId:f.ownerId,roles:['OWNER'],expectedVersion:1});
    f.db.prepare('UPDATE users SET authorization_revision=1 WHERE id=?').run(f.ownerId);
    await expect(f.auth.authorizeSingleOperation(actor,'TAX_PROFILE_MANAGE','1111')).rejects.toMatchObject({code:'USER_REVIEW_REQUIRED'});
    await f.store.mutate(floor=>updateRecoverySecurityFloor(floor,{recoveryEpoch:1}));
    expect(f.auth.isTokenAuthorized(restored.token,'OWN_PIN_CHANGE')).toBe(false);
  });
  it('does not expand stored role grants, permit cross-binding users, or reuse a command from another module',async()=>{
    const f=await fixture();
    f.db.prepare("DELETE FROM role_permissions WHERE permission_code='PERSONNEL_MANAGE'").run();
    await expect(f.run({kind:'DISABLE'})).rejects.toThrow('PERMISSION_DENIED');
    f.db.prepare("INSERT INTO role_permissions(role_id,permission_code) SELECT id,'PERSONNEL_MANAGE' FROM roles WHERE name='OWNER'").run();
    const commandId=id();f.db.prepare('INSERT INTO processed_commands VALUES(?,1)').run(commandId);
    await expect(f.run({kind:'DISABLE',commandId})).rejects.toThrow('COMMAND_ID_CONFLICT');
    f.db.prepare('UPDATE users SET location_id=? WHERE id=?').run(id(),f.workerId);
    await expect(f.run({kind:'DISABLE'})).rejects.toThrow('PERSONNEL_BINDING_MISMATCH');
  });
  it('introduces a verified 1V baseline without changing PINs, and protects it from generic writers',async()=>{
    const f=await fixture(),floor=await f.store.load();
    expect(floor.personnel?.initializationState).toBe('ACTIVE');
    expect(f.row().pinHash).toBe(f.workerHash);
    expect(floor.personnel?.users[f.workerId]).toEqual({credentialRevision:1,authorizationRevision:1,sessionRevision:1,pending:null});
    expect(JSON.stringify(floor.personnel)).not.toContain(f.workerHash);
    expect(JSON.stringify(floor.personnel)).not.toContain('Worker');
    await expect(f.store.mutate(current=>updateRecoverySecurityFloor(current,{personnel:{...current.personnel!,users:{...current.personnel!.users,
      [f.workerId]:{...current.personnel!.users[f.workerId]!,credentialRevision:2}}}}))).rejects.toThrow('PERSONNEL_SECURITY_WRITER_REQUIRED');
  });
  it('rotates credentials with exact intent/receipt, preserves authorization, and rejects restored old revisions',async()=>{
    const f=await fixture();
    await f.run({kind:'ROTATE_CREDENTIAL',newPin:'3333'});
    const floor=await f.store.load();
    expect(floor.personnel!.users[f.workerId]).toEqual({credentialRevision:2,authorizationRevision:1,sessionRevision:2,pending:null});
    expect(await verifyOperationalPin('3333',f.row().pinHash)).toBe(true);
    expect(await verifyOperationalPin('2222',f.row().pinHash)).toBe(false);
    const exported=JSON.stringify(f.db.prepare('SELECT payload FROM event_log').all())+JSON.stringify(f.db.prepare('SELECT before_json,after_json FROM audit_log').all());
    expect(exported).not.toContain('pinHash');expect(exported).not.toContain('3333');
    f.db.prepare('UPDATE users SET pin_hash=?,credential_revision=1 WHERE id=?').run(f.workerHash,f.workerId);
    expect(personnelRestrictions(floor.personnel!,f.row())).toContain('CREDENTIAL_RESET_REQUIRED');
  });
  it('keeps a floor reservation without intent blocked and repairs with a higher revision and new PIN',async()=>{
    const f=await fixture(),original=f.db.prepare.bind(f.db);
    const spy=vi.spyOn(f.db,'prepare').mockImplementation(sql=>{
      if(sql.includes('INSERT INTO personnel_security_intents'))throw new Error('simulated interrupted write');return original(sql);
    });
    await expect(f.run({kind:'ROTATE_CREDENTIAL',newPin:'3333'})).rejects.toThrow('simulated interrupted write');
    spy.mockRestore();
    const reserved=await f.store.load();
    expect(reserved.personnel!.users[f.workerId]!.credentialRevision).toBe(2);
    expect(f.row().pinHash).toBe(f.workerHash);
    await performPersonnelSecurityOperation(f.store,{kind:'RECONCILE',sqlite:f.db});
    expect(personnelRestrictions((await f.store.load()).personnel!,f.row())).toContain('USER_SECURITY_REPAIR_REQUIRED');
    await f.run({kind:'REPAIR',roles:['WAITER'],status:'ACTIVE',newPin:'4444'});
    expect((await f.store.load()).personnel!.users[f.workerId]!.credentialRevision).toBe(3);
    expect((await f.store.load()).personnel!.users[f.workerId]!.pending).toBeNull();
    expect(await verifyOperationalPin('4444',f.row().pinHash)).toBe(true);
  });
  it('resumes committed SQLite when completion was interrupted; mismatched digest never clears pending',async()=>{
    const f=await fixture(),original=f.db.prepare.bind(f.db);
    const spy=vi.spyOn(f.db,'prepare').mockImplementation(sql=>{
      if(sql.startsWith('SELECT transition_digest AS digest,credential_revision'))throw new Error('simulated post-commit crash');return original(sql);
    });
    await expect(f.run({kind:'ROTATE_CREDENTIAL',newPin:'3333'})).rejects.toThrow('simulated post-commit crash');spy.mockRestore();
    const pending=(await f.store.load()).personnel!.users[f.workerId]!.pending!;
    expect(f.row().credentialRevision).toBe(2);
    f.db.prepare('UPDATE personnel_security_receipts SET transition_digest=? WHERE transition_id=?').run('0'.repeat(64),pending.transitionId);
    await expect(performPersonnelSecurityOperation(f.store,{kind:'RECONCILE',sqlite:f.db})).resolves.toBeUndefined();
    expect((await f.store.load()).personnel!.users[f.workerId]!.pending).not.toBeNull();
    f.db.prepare('UPDATE personnel_security_receipts SET transition_digest=? WHERE transition_id=?').run(pending.transitionDigest,pending.transitionId);
    await performPersonnelSecurityOperation(f.store,{kind:'RECONCILE',sqlite:f.db});
    expect((await f.store.load()).personnel!.users[f.workerId]!.pending).toBeNull();
  });
  it('requires fresh credentials to re-enable and retains disabled PIN uniqueness',async()=>{
    const f=await fixture();await f.run({kind:'DISABLE'});
    await expect(f.run({kind:'REENABLE',expectedVersion:2})).rejects.toThrow('PERSONNEL_NEW_PIN_REQUIRED');
    await expect(f.run({kind:'ENROLL',userId:id(),expectedVersion:0,displayName:'New',roles:['WAITER'],newPin:'2222'})).rejects.toThrow('PERSONNEL_PIN_NOT_UNIQUE');
    await f.run({kind:'REENABLE',expectedVersion:2,newPin:'3333'});
    expect(personnelRestrictions((await f.store.load()).personnel!,f.row())).toEqual([]);
    expect(f.row().status).toBe('ACTIVE');
  });
  it('renames personnel through a dedicated crash-safe transition without changing credentials or grants',async()=>{
    const f=await fixture();
    await f.run({kind:'RENAME',displayName:'Mesero principal'});
    expect(f.db.prepare('SELECT display_name AS displayName,version FROM users WHERE id=?').get(f.workerId)).toEqual({displayName:'Mesero principal',version:2});
    expect((await f.store.load()).personnel!.users[f.workerId]).toEqual({credentialRevision:1,authorizationRevision:1,sessionRevision:2,pending:null});
    expect(await verifyOperationalPin('2222',f.row().pinHash)).toBe(true);
    expect((f.db.prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?').all(f.workerId) as Array<{name:string}>).map(x=>x.name)).toEqual(['WAITER']);
  });
});
