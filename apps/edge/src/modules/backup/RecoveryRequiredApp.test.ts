import { afterEach,describe,expect,it } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';import { join } from 'node:path';import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';import { generateKeyPairSync,randomBytes } from 'node:crypto';
import { signRecoveryAuthorization } from '@comanview/licensing';
import { createEncryptedBackupArtifact } from './BackupArtifact.js';
import { buildRecoveryRequiredApp } from './RecoveryRequiredApp.js';
import { ensureRecoveryKey,MemoryRecoverySecurityStore,updateRecoverySecurityFloor } from './RecoverySecurityStore.js';

const tenantId='01991a00-0000-7000-8000-000000000701',locationId='01991a00-0000-7000-8000-000000000702',
  edgeId='01991a00-0000-7000-8000-000000000703',backupId='01991a00-0000-7000-8000-000000000704';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('recovery-only Edge surface',()=>{it('does not create an empty operational DB and schedules a verified emergency restore',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cv-recovery-app-'));roots.push(root);const sourcePath=join(root,'source.db'),missingPath=join(root,'missing.db');
  const source=new Database(sourcePath);source.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT,recovery_epoch INTEGER);
    INSERT INTO edge_installations VALUES('PRIMARY','${tenantId}','${locationId}','${edgeId}',0);`);
  const store=new MemoryRecoverySecurityStore();let floor=ensureRecoveryKey(await store.load()).floor;
  floor=updateRecoverySecurityFloor(floor,{installationEstablished:true,binding:{tenantId,locationId,edgeId},recoveryState:'RECOVERY_REQUIRED',journal:{
    recoveryId:'failed-recovery',commandId:'01991a00-0000-7000-8000-000000000799',backupId:'01991a00-0000-7000-8000-000000000798',
    artifactPath:'failed-artifact',phase:'VALIDATING',startedAt:'2026-09-01T00:00:00.000Z',originalDatabasePath:missingPath,
    stagedDatabasePath:null,nextRecoveryEpoch:1,authorizationId:null,targetBinding:{tenantId,locationId,edgeId},enteredFromRecoveryRequired:true}});await store.save(floor);
  const artifact=await createEncryptedBackupArtifact({source,destinationDirectory:join(root,'backups'),backupId,
    binding:{tenantId,locationId,edgeId,recoveryEpoch:0},recoveryKey:floor.recoveryKey!,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});source.close();
  const app=await buildRecoveryRequiredApp({dbPath:missingPath,securityStore:store,syncConfig:{enabled:false,cloudUrl:null,token:null,configuredEdgeId:null,batchSize:1,pollIntervalMs:1000,requestTimeoutMs:1000,leaseDurationMs:1000,heartbeatIntervalMs:1000,edgeVersion:'test',schemaVersion:'14',licensing:{enforcementEnabled:false,publicKeyring:{},pullIntervalMs:1000,maxBackoffMs:1000,checkpointIntervalMs:1000}}});
  const health=await app.inject({url:'/health'});expect(health.statusCode).toBe(200);expect(health.json()).toMatchObject({status:'DOWN',database:{status:'ERROR'}});
  const response=await app.inject({method:'POST',url:'/recovery/emergency-restore',payload:{commandId:'01991a00-0000-7000-8000-000000000705',backupId,
    artifactPath:artifact.artifactPath,recoveryKey:floor.recoveryKey,confirmation:'RESTORE_VERIFIED_BACKUP'}});
  expect(response.statusCode).toBe(202);expect((await store.load()).journal).toMatchObject({backupId,targetBinding:{edgeId}});await app.close();
});
  it('fails closed for an expired hardware RecoveryAuthorization and accepts the exact signed binding',async()=>{const root=await mkdtemp(join(tmpdir(),'cv-hardware-recovery-'));roots.push(root);
    const sourceEdgeId='01991a00-0000-7000-8000-000000000710',sourcePath=join(root,'source.db'),targetPath=join(root,'target.db');const source=new Database(sourcePath);
    source.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT,recovery_epoch INTEGER);INSERT INTO edge_installations VALUES('PRIMARY','${tenantId}','${locationId}','${sourceEdgeId}',0);`);
    const key=randomBytes(32).toString('base64url'),artifact=await createEncryptedBackupArtifact({source,destinationDirectory:join(root,'backups'),backupId,
      binding:{tenantId,locationId,edgeId:sourceEdgeId,recoveryEpoch:0},recoveryKey:key,trigger:'MANUAL',destinationType:'OFF_DEVICE',businessDate:null});source.close();
    const pair=generateKeyPairSync('ed25519'),privateKey=pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),publicKey=pair.publicKey.export({format:'pem',type:'spki'}).toString();
    const base={formatVersion:1 as const,typ:'comanview-recovery-authorization' as const,authorizationId:'01991a00-0000-7000-8000-000000000711',tenantId,locationId,sourceEdgeId,targetEdgeId:edgeId,backupId,recoveryEpoch:1,purpose:'HARDWARE_REPLACEMENT_RESTORE' as const,issuedAt:'2026-09-01T00:00:00.000Z',nonce:'01991a00-0000-7000-8000-000000000712'};
    const store=new MemoryRecoverySecurityStore();let floor=updateRecoverySecurityFloor(await store.load(),{installationEstablished:true,binding:{tenantId,locationId,edgeId},recoveryState:'RECOVERY_REQUIRED'});await store.save(floor);
    const app=await buildRecoveryRequiredApp({dbPath:targetPath,securityStore:store,syncConfig:{enabled:false,cloudUrl:null,token:null,configuredEdgeId:null,batchSize:1,pollIntervalMs:1000,requestTimeoutMs:1000,leaseDurationMs:1000,heartbeatIntervalMs:1000,edgeVersion:'test',schemaVersion:'14',licensing:{enforcementEnabled:true,publicKeyring:{current:publicKey},pullIntervalMs:1000,maxBackoffMs:1000,checkpointIntervalMs:1000}}});
    const payload={commandId:'01991a00-0000-7000-8000-000000000713',backupId,artifactPath:artifact.artifactPath,recoveryKey:key,confirmation:'RESTORE_VERIFIED_BACKUP',
      recoveryAuthorization:signRecoveryAuthorization({...base,expiresAt:'2026-09-01T00:01:00.000Z'},'current',privateKey)};
    const expired=await app.inject({method:'POST',url:'/recovery/emergency-restore',payload});expect(expired.statusCode).toBe(401);
    const valid=await app.inject({method:'POST',url:'/recovery/emergency-restore',payload:{...payload,commandId:'01991a00-0000-7000-8000-000000000714',
      recoveryAuthorization:signRecoveryAuthorization({...base,expiresAt:'2099-09-01T00:30:00.000Z'},'current',privateKey)}});expect(valid.statusCode).toBe(202);await app.close();
  });});
