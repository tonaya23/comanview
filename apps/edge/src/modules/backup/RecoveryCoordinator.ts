import { mkdir,open,rename,stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname,join,resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as edgeSchema from '@comanview/database/edge';
import { EntityId } from '@comanview/domain';
import { insertAuditEntry,inspectRecoveryUpgradeSchema,type BackupRepository } from '@comanview/database';
import type { RecoveryAuthorizationEnvelope } from '@comanview/contracts';
import { verifyRecoveryAuthorization } from '@comanview/licensing';
import { AppError } from '../../app/errorHandler.js';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { verifyEncryptedBackupArtifact } from './BackupArtifact.js';
import { isDeviceRevokedByFloor,mergeRecoverySecurityMetadata,updateRecoverySecurityFloor,type RecoveryJournal,type RecoverySecurityStore } from './RecoverySecurityStore.js';
import type { BackupManager } from './BackupManager.js';
import { reconcileLicenseDecision } from '../licensing/LicensingSecurity.js';

interface ScheduleJournalInput {backupId:string;artifactPath:string;recoveryKey:string;
  recoveryAuthorization?:RecoveryAuthorizationEnvelope;binding:{tenantId:string;locationId:string;edgeId:string};
  publicKeyring:Readonly<Record<string,string>>;securityStore:RecoverySecurityStore;dbPath:string;now:Date}

export class RecoveryCoordinator {
  private running=false;
  constructor(private repository:BackupRepository,private backupManager:BackupManager,
    private securityStore:RecoverySecurityStore,private dbPath:string,
    private binding:{tenantId:string;locationId:string;edgeId:string},private publicKeyring:Readonly<Record<string,string>>,
    private requestRestart:()=>void=()=>undefined){}

  async schedule(input:{commandId:string;backupId:string;artifactPath?:string;recoveryKey?:string;
    recoveryAuthorization?:RecoveryAuthorizationEnvelope;actor:AuthenticatedActor},now=new Date()){
    if(this.running)throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery is already being prepared.');
    this.running=true;let recoveryBarrier=false,journalSaved=false;try{
    const row=this.repository.get(input.backupId);
    if(row&&row.status!=='VERIFIED')throw new AppError('BACKUP_NOT_VERIFIED',409,'Only a verified backup may be restored.');
    if(!row&&!input.artifactPath)throw new AppError('BACKUP_NOT_FOUND',404,'Backup was not found.');
    const obligations=this.repository.activeOperationalObligations();
    if(obligations.openCashSessions>0||obligations.openOrders>0)
      throw new AppError('RECOVERY_ACTIVE_OPERATION',409,'Close active cash sessions and Orders before a planned restore.');
    let floor=await this.securityStore.load();if(floor.journal?.commandId===input.commandId)return {scheduled:true as const,recoveryState:'RECOVERY_IN_PROGRESS' as const};
    if(floor.recoveryState!=='NORMAL')throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery is already in progress.');
    if(!this.backupManager.beginRecoveryPreparation(input.backupId))throw new AppError('BACKUP_IN_PROGRESS',409,
      'Wait for the active backup to finish before starting recovery.');
    recoveryBarrier=true;
    const key=input.recoveryKey??floor.recoveryKey;if(!key)throw new AppError('RECOVERY_KEY_INVALID',401,'A valid Recovery Key is required.');
    let nextEpoch=floor.recoveryEpoch+1,authorizationId:string|null=null,expectedSource=this.binding.edgeId;
    if(input.recoveryAuthorization){let verified;try{verified=verifyRecoveryAuthorization(input.recoveryAuthorization,this.publicKeyring);}
      catch{throw new AppError('RECOVERY_AUTHORIZATION_INVALID',401,'Recovery authorization is invalid.');}
      const p=verified.payload;if(p.tenantId!==this.binding.tenantId||p.locationId!==this.binding.locationId||p.targetEdgeId!==this.binding.edgeId||
        p.backupId!==input.backupId||p.purpose!=='HARDWARE_REPLACEMENT_RESTORE')throw new AppError('RECOVERY_AUTHORIZATION_INVALID',401,'Recovery authorization binding is invalid.');
      if(Date.parse(p.expiresAt)<=now.getTime())throw new AppError('RECOVERY_AUTHORIZATION_EXPIRED',401,'Recovery authorization has expired.');
      if(p.recoveryEpoch<=floor.recoveryEpoch)throw new AppError('RECOVERY_AUTHORIZATION_CONSUMED',409,'Recovery authorization epoch was already consumed.');
      nextEpoch=p.recoveryEpoch;authorizationId=p.authorizationId;expectedSource=p.sourceEdgeId;
    }
    const stageDirectory=resolve(dirname(this.dbPath),'.recovery-staging',EntityId.generate().toString());await mkdir(stageDirectory,{recursive:true});
    const artifactPath=row?.artifactPath??resolve(input.artifactPath!);
    let verified:Awaited<ReturnType<typeof verifyEncryptedBackupArtifact>>;
    try{verified=await verifyEncryptedBackupArtifact({artifactPath,recoveryKey:key,
      expectedBackupId:input.backupId,
      expectedBinding:{tenantId:this.binding.tenantId,locationId:this.binding.locationId,edgeId:expectedSource},stagingDirectory:stageDirectory});}
    catch(error){const code=safeRecoveryFailureCode(error);this.backupManager.auditRecovery('RECOVERY_FAILED',input.backupId,
      input.actor,input.commandId,code,now);throw new AppError('RECOVERY_BACKUP_INVALID',400,'Recovery backup validation failed.');}
    try{
      await this.backupManager.create({commandId:EntityId.generate().toString(),destinationType:'LOCAL',trigger:'SAFETY',
        actor:input.actor,allowDuringRecovery:true}).catch(()=>undefined);
      const recoveryId=EntityId.generate().toString();
      this.backupManager.auditRecovery('RECOVERY_INITIATED',input.backupId,input.actor,input.commandId,
        'Verified backup recovery scheduled.',now);
      floor=updateRecoverySecurityFloor(floor,{recoveryState:'RECOVERY_IN_PROGRESS',journal:{recoveryId,commandId:input.commandId,
        backupId:input.backupId,artifactPath,phase:'PREPARING',startedAt:now.toISOString(),originalDatabasePath:this.dbPath,
        stagedDatabasePath:verified.stagedDatabasePath,stagedDatabaseSha256:await syncStaging(verified.stagedDatabasePath),nextRecoveryEpoch:nextEpoch,authorizationId,
        targetBinding:{...this.binding},enteredFromRecoveryRequired:false}});
      await this.securityStore.save(floor);journalSaved=true;setTimeout(()=>this.requestRestart(),50).unref();
      return {scheduled:true as const,recoveryState:'RECOVERY_IN_PROGRESS' as const};
    }finally{if(!journalSaved)await discardUnscheduledStaging(verified,this.securityStore);}
    }finally{if(recoveryBarrier&&!journalSaved)this.backupManager.cancelRecoveryPreparation();this.running=false;}
  }
}

export async function scheduleEmergencyRecovery(input:ScheduleJournalInput&{commandId:string}){
  let floor=await input.securityStore.load();
  if(floor.recoveryState==='RECOVERY_IN_PROGRESS'&&floor.journal?.commandId===input.commandId)
    return {scheduled:true as const,recoveryState:'RECOVERY_IN_PROGRESS' as const};
  if(!floor.installationEstablished||!floor.binding||floor.recoveryState==='RECOVERY_IN_PROGRESS')
    throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery state does not allow a new recovery.');
  let nextEpoch=floor.recoveryEpoch+1,authorizationId:string|null=null,expectedSource=input.binding.edgeId;
  if(input.recoveryAuthorization){let verified;
    try{verified=verifyRecoveryAuthorization(input.recoveryAuthorization,input.publicKeyring);}
    catch{throw new AppError('RECOVERY_AUTHORIZATION_INVALID',401,'Recovery authorization is invalid.');}
    const p=verified.payload;
    if(p.tenantId!==input.binding.tenantId||p.locationId!==input.binding.locationId||p.targetEdgeId!==input.binding.edgeId||
      p.backupId!==input.backupId||p.purpose!=='HARDWARE_REPLACEMENT_RESTORE')
      throw new AppError('RECOVERY_AUTHORIZATION_INVALID',401,'Recovery authorization binding is invalid.');
    if(Date.parse(p.expiresAt)<=input.now.getTime())throw new AppError('RECOVERY_AUTHORIZATION_EXPIRED',401,'Recovery authorization has expired.');
    if(p.recoveryEpoch<=floor.recoveryEpoch)throw new AppError('RECOVERY_AUTHORIZATION_CONSUMED',409,'Recovery authorization epoch was already consumed.');
    nextEpoch=p.recoveryEpoch;authorizationId=p.authorizationId;expectedSource=p.sourceEdgeId;
  }
  const stageDirectory=resolve(dirname(input.dbPath),'.recovery-staging',EntityId.generate().toString());
  await mkdir(stageDirectory,{recursive:true});
  let verified:Awaited<ReturnType<typeof verifyEncryptedBackupArtifact>>;
  try{verified=await verifyEncryptedBackupArtifact({artifactPath:resolve(input.artifactPath),recoveryKey:input.recoveryKey,
    expectedBackupId:input.backupId,expectedBinding:{tenantId:input.binding.tenantId,locationId:input.binding.locationId,
      edgeId:expectedSource},stagingDirectory:stageDirectory});}
  catch(error){const code=safeRecoveryFailureCode(error);await input.securityStore.save(updateRecoverySecurityFloor(floor,{
    recoveryState:'RECOVERY_REQUIRED',pendingRecoveryFailure:{commandId:input.commandId,backupId:input.backupId,
      occurredAt:input.now.toISOString(),code}}));throw new AppError('RECOVERY_BACKUP_INVALID',400,'Recovery backup validation failed.');}
  let journalSaved=false;
  try{
    const recoveryId=EntityId.generate().toString();
    floor=updateRecoverySecurityFloor(floor,{recoveryState:'RECOVERY_IN_PROGRESS',journal:{recoveryId,commandId:input.commandId,
      backupId:input.backupId,artifactPath:resolve(input.artifactPath),phase:'PREPARING',startedAt:input.now.toISOString(),originalDatabasePath:input.dbPath,
      stagedDatabasePath:verified.stagedDatabasePath,stagedDatabaseSha256:await syncStaging(verified.stagedDatabasePath),nextRecoveryEpoch:nextEpoch,authorizationId,
      targetBinding:{...input.binding},enteredFromRecoveryRequired:true}});
    await input.securityStore.save(floor);journalSaved=true;
    return {scheduled:true as const,recoveryState:'RECOVERY_IN_PROGRESS' as const};
  }finally{if(!journalSaved)await discardUnscheduledStaging(verified,input.securityStore);}
}

export async function completePendingRecoveryAtStartup(input:{dbPath:string;store:RecoverySecurityStore}):Promise<'NONE'|'COMPLETED'|'RECOVERY_REQUIRED'>{
  let floor=await input.store.load();const journal=floor.journal;if(!journal)return floor.recoveryState==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'NONE';
  const preserved=`${input.dbPath}.pre-recovery-${journal.recoveryId}`;
  try{
    if(!journal.stagedDatabasePath||!journal.originalDatabasePath||
      resolve(journal.originalDatabasePath)!==resolve(input.dbPath)||
      !journal.stagedDatabaseSha256||!/^[a-f0-9]{64}$/.test(journal.stagedDatabaseSha256)||
      !['PREPARING','QUIESCED','SWAPPED','VALIDATING'].includes(journal.phase))
      throw new Error('RECOVERY_SWAP_EVIDENCE_MISSING');
    if(!floor.binding||floor.binding.tenantId!==journal.targetBinding.tenantId||
      floor.binding.locationId!==journal.targetBinding.locationId||floor.binding.edgeId!==journal.targetBinding.edgeId)
      throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
    if(!Number.isSafeInteger(journal.nextRecoveryEpoch)||journal.nextRecoveryEpoch<floor.recoveryEpoch)
      throw new Error('RECOVERY_EPOCH_ROLLBACK');
    if(journal.phase==='PREPARING'){
      await assertSnapshot(journal.stagedDatabasePath,journal.stagedDatabaseSha256);
      // Never overwrite evidence if a previous rename completed before its journal write.
      if(await pathExists(input.dbPath)){
        if(await pathExists(preserved))throw new Error('RECOVERY_SWAP_AMBIGUOUS');
        await rename(input.dbPath,preserved);
      }
      await renameIfPresent(`${input.dbPath}-wal`,`${preserved}-wal`);
      await renameIfPresent(`${input.dbPath}-shm`,`${preserved}-shm`);
      floor=updateRecoverySecurityFloor(floor,{journal:{...journal,phase:'QUIESCED'}});await input.store.save(floor);
    }
    if((floor.journal??journal).phase==='QUIESCED'){
      if(await pathExists(journal.stagedDatabasePath)){
        if(await pathExists(input.dbPath))throw new Error('RECOVERY_SWAP_AMBIGUOUS');
        await assertSnapshot(journal.stagedDatabasePath,journal.stagedDatabaseSha256);
        await assertNoSidecars(input.dbPath);
        await rename(journal.stagedDatabasePath,input.dbPath);
      }
      // Also resolves a crash between the physical rename and persisting SWAPPED.
      await assertSnapshot(input.dbPath,journal.stagedDatabaseSha256);
      floor=updateRecoverySecurityFloor(floor,{journal:{...journal,phase:'SWAPPED'}});await input.store.save(floor);
    }
    if(floor.journal?.phase==='SWAPPED'){
      await assertSnapshot(input.dbPath,journal.stagedDatabaseSha256);
      floor=updateRecoverySecurityFloor(floor,{journal:{...journal,phase:'VALIDATING'}});await input.store.save(floor);
    }
    if(floor.journal?.phase!=='VALIDATING')throw new Error('RECOVERY_SWAP_EVIDENCE_MISSING');
    // A validation retry needs either the pristine expected snapshot, or the receipt
    // committed atomically with the previous validation/security transaction.
    const check=new Database(input.dbPath,{readonly:true,fileMustExist:true});
    let receipt=false;
    try{assertIntegrityAndSchema(check);receipt=hasValidationReceipt(check,journal);}
    finally{check.close();}
    if(!receipt)await assertSnapshot(input.dbPath,journal.stagedDatabaseSha256);
    const sqlite=new Database(input.dbPath,{fileMustExist:true});
    try{
      if(journal.nextRecoveryEpoch<floor.recoveryEpoch)throw new Error('RECOVERY_EPOCH_ROLLBACK');
      assertIntegrityAndSchema(sqlite);
      const tx=sqlite.transaction(()=>{
        const changed=sqlite.prepare(`UPDATE edge_installations SET tenant_id=?, location_id=?, edge_id=?, recovery_epoch=?
          WHERE singleton_key='PRIMARY'`).run(journal.targetBinding.tenantId,journal.targetBinding.locationId,
            journal.targetBinding.edgeId,journal.nextRecoveryEpoch);
        if(changed.changes!==1)throw new Error('RECOVERY_BINDING_INVALID');
        const now=Date.now();
        sqlite.prepare(`UPDATE backup_records SET status='VERIFIED',artifact_path=?,completed_at=COALESCE(completed_at,?),
          verified_at=COALESCE(verified_at,?),failure_code=NULL,failure_detail=NULL WHERE backup_id=?`)
          .run(journal.artifactPath,now,now,journal.backupId);
        sqlite.prepare(`UPDATE backup_runtime SET worker_status='IDLE',last_verified_backup_id=?,
          last_successful_backup_at=COALESCE(last_successful_backup_at,?),last_failure_code=NULL,updated_at=?
          WHERE singleton_key='PRIMARY'`).run(journal.backupId,now,now);
        sqlite.prepare(`UPDATE event_log SET recovery_epoch=? WHERE sync_status IN ('PENDING','SYNCING','FAILED')`)
          .run(journal.nextRecoveryEpoch);
        const devices=sqlite.prepare('SELECT id FROM devices').all() as Array<{id:string}>;
        const revoke=sqlite.prepare("UPDATE devices SET status='REVOKED',revoked_at=COALESCE(revoked_at,?) WHERE id=? AND status!='REVOKED'");
        const credential=sqlite.prepare('UPDATE device_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=?');
        const sessions=sqlite.prepare('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=?');
        const hardwareReplacement=journal.authorizationId!==null;
        for(const d of devices)if(hardwareReplacement||isDeviceRevokedByFloor(floor,d.id)){
          revoke.run(now,d.id);credential.run(now,d.id);sessions.run(now,d.id);
        }
        sqlite.prepare(`UPDATE edge_control_runtime SET sticky_declared_state=CASE
          WHEN ?='TERMINATED' THEN 'TERMINATED' WHEN sticky_declared_state='TERMINATED' THEN 'TERMINATED'
          WHEN ?='SUSPENDED' THEN 'SUSPENDED' ELSE sticky_declared_state END WHERE singleton_key='PRIMARY'`)
          .run(floor.stickyDeclaredState,floor.stickyDeclaredState);
        if(journal.authorizationId){
          sqlite.prepare('UPDATE edge_control_documents SET is_current=0').run();
        }else{
          for(const [type,revision] of Object.entries(floor.maximumSignedRevisions))
            sqlite.prepare('UPDATE edge_control_documents SET is_current=0 WHERE document_type=? AND revision<?').run(type,revision);
          reconcileLicenseDecision(sqlite,floor);
        }
        if(!receipt)insertAuditEntry(drizzle(sqlite,{schema:edgeSchema}),{
          auditId:journal.recoveryId,occurredAt:new Date(),tenantId:journal.targetBinding.tenantId,
          locationId:journal.targetBinding.locationId,deviceId:null,sessionId:null,actorUserId:null,actorRole:null,
          actorType:'SYSTEM',source:'RECOVERY_STARTUP',authorizedByUserId:null,authorizedByRole:null,
          action:'RECOVERY_VALIDATED',entityType:'RECOVERY',entityId:journal.backupId,outcome:'SUCCESS',
          reason:'Expected restored SQLite validated; security transaction committed.',commandId:journal.commandId,
          before:null,after:validationReceipt(journal),amountAffected:null,currency:null,eventId:null});
      });tx();
      assertIntegrityAndSchema(sqlite);
      if(!hasValidationReceipt(sqlite,journal))throw new Error('RECOVERY_VALIDATION_RECEIPT_MISSING');
      // SQLite revocations are durable first. Keep the SWAPPED/VALIDATING journal
      // until their monotonic floor is durable too. A crash in either window
      // repeats the same idempotent SQL and merge; NORMAL is never published early.
      floor=await input.store.mutate(current=>{
        if(current.journal?.recoveryId!==journal.recoveryId)throw new Error('RECOVERY_SECURITY_STALE_WRITE');
        return updateRecoverySecurityFloor(mergeRecoverySecurityMetadata(current,sqlite),{
          recoveryEpoch:journal.nextRecoveryEpoch});
      });
    }finally{sqlite.close();}
    const completedAt=new Date().toISOString();
    floor=updateRecoverySecurityFloor(floor,{recoveryEpoch:Math.max(floor.recoveryEpoch,journal.nextRecoveryEpoch),
      recoveryState:'NORMAL',journal:null,pendingRecoveryAuthorizationAck:journal.authorizationId?{
        authorizationId:journal.authorizationId,commandId:EntityId.generate().toString(),consumedAt:completedAt}:floor.pendingRecoveryAuthorizationAck,
      pendingRecoveryAudit:{recoveryId:journal.recoveryId,commandId:journal.commandId,backupId:journal.backupId,startedAt:journal.startedAt,
        completedAt,enteredFromRecoveryRequired:journal.enteredFromRecoveryRequired}});
    await input.store.save(floor);return 'COMPLETED';
  }catch(error){
    await input.store.mutate(current=>current.journal?.recoveryId===journal.recoveryId?
      updateRecoverySecurityFloor(current,{recoveryState:'RECOVERY_REQUIRED',
        pendingRecoveryFailure:{commandId:journal.commandId,backupId:journal.backupId,
          occurredAt:new Date().toISOString(),code:safeRecoveryFailureCode(error)}}):current);return 'RECOVERY_REQUIRED';
  }
}

async function renameIfPresent(source:string,destination:string){
  if(await pathExists(source)&&await pathExists(destination))throw new Error('RECOVERY_SWAP_AMBIGUOUS');
  await rename(source,destination).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
}
async function discardUnscheduledStaging(verified:Awaited<ReturnType<typeof verifyEncryptedBackupArtifact>>,store:RecoverySecurityStore){
  // A save can fail after its durable rename (e.g. ACL application). Do not
  // destroy staging referenced by a persisted journal, or when that is unknown.
  const floor=await store.load().catch(()=>null);
  if(floor&&floor.journal?.stagedDatabasePath!==verified.stagedDatabasePath)await verified.cleanup().catch(()=>undefined);
}
async function hashFile(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function syncStaging(path:string){
  // Only the decrypted isolated staging copy is consolidated. Its evidence must
  // describe a standalone file, not a DB whose committed state lives in WAL.
  const db=new Database(path,{fileMustExist:true});
  try{if(db.pragma('journal_mode=DELETE',{simple:true})!=='delete')throw new Error('RECOVERY_STAGING_BUSY');}
  finally{db.close();}
  const file=await open(path,'r+');try{await file.sync();}finally{await file.close();}return hashFile(path);
}
async function assertNoSidecars(path:string){for(const suffix of ['-wal','-shm','-journal'])
  if(await pathExists(`${path}${suffix}`))throw new Error('RECOVERY_SWAP_AMBIGUOUS');}
async function assertSnapshot(path:string,expected:string){
  await assertNoSidecars(path);
  if((await hashFile(path))!==expected)throw new Error('RECOVERY_SNAPSHOT_MISMATCH');
  const db=new Database(path,{readonly:true,fileMustExist:true});try{assertIntegrityAndSchema(db);}finally{db.close();}
}
function assertIntegrityAndSchema(db:Database.Database){
  const integrity=db.pragma('integrity_check') as Array<{integrity_check:string}>;
  if(integrity.length!==1||integrity[0]?.integrity_check!=='ok')throw new Error('RECOVERY_BACKUP_INVALID');
  if(inspectRecoveryUpgradeSchema(db)!==14)throw new Error('RECOVERY_SCHEMA_INVALID');
}
function validationReceipt(j:RecoveryJournal){return {recoveryId:j.recoveryId,backupId:j.backupId,
  stagedDatabaseSha256:j.stagedDatabaseSha256,targetBinding:j.targetBinding,nextRecoveryEpoch:j.nextRecoveryEpoch};}
function hasValidationReceipt(db:Database.Database,j:RecoveryJournal){
  const row=db.prepare(`SELECT after_json FROM audit_log WHERE audit_id=? AND action='RECOVERY_VALIDATED'
    AND entity_type='RECOVERY' AND entity_id=? AND command_id=? AND source='RECOVERY_STARTUP' AND outcome='SUCCESS'`)
    .get(j.recoveryId,j.backupId,j.commandId) as {after_json:string}|undefined;
  if(!row)return false;
  if(row.after_json!==JSON.stringify(validationReceipt(j)))throw new Error('RECOVERY_VALIDATION_RECEIPT_INVALID');
  const binding=db.prepare("SELECT tenant_id,location_id,edge_id,recovery_epoch FROM edge_installations WHERE singleton_key='PRIMARY'")
    .get() as {tenant_id:string;location_id:string;edge_id:string;recovery_epoch:number}|undefined;
  if(!binding||binding.tenant_id!==j.targetBinding.tenantId||binding.location_id!==j.targetBinding.locationId||
    binding.edge_id!==j.targetBinding.edgeId||binding.recovery_epoch!==j.nextRecoveryEpoch)throw new Error('RECOVERY_VALIDATION_RECEIPT_INVALID');
  return true;
}
async function pathExists(path:string){return stat(path).then(()=>true).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return false;throw error;});}
function safeRecoveryFailureCode(error:unknown){const value=error instanceof Error?error.message:'RECOVERY_FAILED';
  return /^[A-Z0-9_]+$/.test(value)?value:'RECOVERY_FAILED';}
