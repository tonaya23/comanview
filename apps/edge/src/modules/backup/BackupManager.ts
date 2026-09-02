import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { EntityId } from '@comanview/domain';
import type { BackupDestinationType, BackupProtectionStatus, BackupTrigger } from '@comanview/contracts';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { AppError } from '../../app/errorHandler.js';
import { BackupRepository, insertAuditEntry, type EdgeDatabase } from '@comanview/database';
import { createEncryptedBackupArtifact } from './BackupArtifact.js';
import { initializeRecoverySecurityFloor, updateRecoverySecurityFloor, type RecoverySecurityStore } from './RecoverySecurityStore.js';

const PERIOD_MS=60*60_000;
const HEALTHY_MAX_AGE_MS=4*60*60_000;

export interface BackupLogger { info(context:object,message:string):void; warn(context:object,message:string):void }

export class BackupManager {
  private running=false;
  private recoveryBarrier=false;
  private protectedRecoveryBackupId:string|null=null;
  constructor(private readonly repository:BackupRepository,private readonly db:EdgeDatabase,
    private readonly sqlite:Database.Database,private readonly securityStore:RecoverySecurityStore,
    private readonly context:{tenantId:string;locationId:string;edgeId:string},
    private readonly localDirectory:string,private readonly log:BackupLogger) {}

  async initialize(now=new Date()):Promise<void>{
    this.repository.recoverInterrupted(now);
    let floor=await initializeRecoverySecurityFloor({store:this.securityStore,sqlite:this.sqlite,binding:this.context});
    if(floor.pendingRecoveryFailure){const failure=floor.pendingRecoveryFailure;
      this.audit('RECOVERY_FAILED',failure.backupId,null,failure.commandId,failure.code,new Date(failure.occurredAt));
      floor=await this.securityStore.mutate(current=>current.pendingRecoveryFailure?.commandId===failure.commandId?
        updateRecoverySecurityFloor(current,{pendingRecoveryFailure:null}):current);
    }
    const backupRuntime=this.repository.runtime();
    if(!backupRuntime.nextPeriodicBackupAt)this.repository.setNextPeriodic(new Date(now.getTime()+PERIOD_MS),now);
    if(floor.pendingRecoveryAudit){
      const pending=floor.pendingRecoveryAudit;
      if(pending.enteredFromRecoveryRequired){
        this.audit('RECOVERY_REQUIRED_ENTERED',pending.backupId,null,EntityId.generate().toString(),
          'Operational database required controlled recovery.',new Date(pending.startedAt));
        this.audit('RECOVERY_INITIATED',pending.backupId,null,pending.commandId,
          'Emergency recovery initiated with a verified artifact.',new Date(pending.startedAt));
      }
      if(!this.sqlite.prepare("SELECT 1 FROM audit_log WHERE audit_id=? AND action='RECOVERY_VALIDATED'").get(pending.recoveryId))
        this.audit('RECOVERY_VALIDATED',pending.backupId,null,EntityId.generate().toString(),
          'Restored database passed integrity and security-floor validation.',new Date(pending.completedAt));
      this.audit('RECOVERY_COMPLETED',pending.backupId,null,EntityId.generate().toString(),
        'Recovery completed and validated.',new Date(pending.completedAt));
      if(pending.enteredFromRecoveryRequired)this.audit('RECOVERY_REQUIRED_EXITED',pending.backupId,null,
        EntityId.generate().toString(),'Normal operation resumed after validated recovery.',new Date(pending.completedAt));
      await this.securityStore.mutate(current=>current.pendingRecoveryAudit?.recoveryId===pending.recoveryId?
        updateRecoverySecurityFloor(current,{pendingRecoveryAudit:null}):current);
    }
  }

  beginRecoveryPreparation(backupId?:string):boolean{
    if(this.running||this.recoveryBarrier)return false;this.recoveryBarrier=true;
    this.protectedRecoveryBackupId=backupId??null;return true;
  }
  cancelRecoveryPreparation():void{this.recoveryBarrier=false;this.protectedRecoveryBackupId=null;}

  async create(input:{commandId:string;destinationType:BackupDestinationType;trigger:BackupTrigger;
    actor:AuthenticatedActor|null;now?:Date;allowDuringRecovery?:boolean}):Promise<ReturnType<BackupManager['record']>>{
    const prior=this.repository.byCommand(input.commandId);if(prior)return this.record(prior);
    if(this.recoveryBarrier&&!input.allowDuringRecovery)
      throw new AppError('RECOVERY_IN_PROGRESS',409,'Backup is unavailable while recovery is being prepared.');
    if(this.running)throw new AppError('BACKUP_IN_PROGRESS',409,'A backup is already in progress.');
    this.running=true;const now=input.now??new Date(),backupId=EntityId.generate().toString();let claimed=false;
    try{
      const floor=await this.securityStore.load();
      if(floor.recoveryState!=='NORMAL')throw new AppError('RECOVERY_IN_PROGRESS',409,'Backup is unavailable during recovery.');
      if(!floor.recoveryKey)throw new AppError('RECOVERY_KEY_INVALID',503,'Recovery Key is unavailable.');
      const destination=input.destinationType==='LOCAL'?this.localDirectory:floor.offDeviceDirectory;
      if(!destination)throw new AppError('BACKUP_DESTINATION_UNAVAILABLE',409,'Off-device backup destination is not configured.');
      const next=new Date(now.getTime()+PERIOD_MS);
      claimed=this.repository.startAttempt(next,now);
      if(!claimed)throw new AppError('BACKUP_IN_PROGRESS',409,'A backup is already in progress.');
      this.repository.create({backupId,tenantId:this.context.tenantId,locationId:this.context.locationId,
        sourceEdgeId:this.context.edgeId,recoveryEpoch:floor.recoveryEpoch,status:'CREATING',trigger:input.trigger,
        destinationType:input.destinationType,artifactPath:resolve(destination,`${backupId}.cvbackup`),formatVersion:1,
        schemaVersion:14,applicationVersion:'1V',businessDate:null,createdAt:now,commandId:input.commandId});
      try{
        this.audit('BACKUP_REQUESTED',backupId,input.actor,input.commandId,`Backup ${input.trigger} solicitado.`,now);
        const result=await createEncryptedBackupArtifact({source:this.sqlite,destinationDirectory:destination,
          backupId,binding:{...this.context,recoveryEpoch:floor.recoveryEpoch},recoveryKey:floor.recoveryKey,
          trigger:input.trigger,destinationType:input.destinationType,businessDate:null,now});
        this.repository.markVerified(backupId,{now:new Date(),sizeBytes:result.manifest.ciphertextSizeBytes,
          hash:result.manifest.ciphertextSha256});
        this.audit('BACKUP_VERIFIED',backupId,input.actor,input.commandId,'Backup verificado correctamente.',new Date());
        await this.applyRetention(destination).catch(error=>this.log.warn({code:safeCode(error,'BACKUP_RETENTION_FAILED')},'Backup retention cleanup failed'));
        this.log.info({backupId,destinationType:input.destinationType,bytes:result.manifest.ciphertextSizeBytes},'Backup verified');
        return this.record(this.repository.get(backupId)!);
      }catch(error){const code=safeCode(error,'BACKUP_FAILED');this.repository.markFailed(backupId,code,'Backup creation or verification failed.',new Date());
        this.audit('BACKUP_FAILED',backupId,input.actor,input.commandId,code,new Date());
        this.log.warn({backupId,destinationType:input.destinationType,code},'Backup failed');
        throw new AppError('BACKUP_FAILED',500,'Backup could not be created and verified.');
      }
    }finally{this.running=false;if(claimed&&this.repository.runtime().workerStatus==='RUNNING')this.repository.finishWithoutBackup(new Date());}
  }

  async status(now=new Date()):Promise<BackupProtectionStatus>{
    const floor=await this.securityStore.load(),runtime=this.repository.runtime(),records=this.repository.list(50);
    const verified=records.filter(r=>r.status==='VERIFIED');
    const latest=verified[0]??null,local=verified.find(r=>r.destinationType==='LOCAL')??null,
      external=verified.find(r=>r.destinationType==='OFF_DEVICE'&&floor.offDeviceDirectory&&
        dirname(r.artifactPath)===resolve(floor.offDeviceDirectory))??null;
    const current=(row:typeof latest)=>row&&row.verifiedAt&&now.getTime()-row.verifiedAt.getTime()<=HEALTHY_MAX_AGE_MS;
    return {recoveryState:floor.recoveryState,localBackupStatus:current(local)?'READY':local?'DEGRADED':'NOT_READY',
      offDeviceBackupStatus:!floor.offDeviceDirectory?'NOT_CONFIGURED':current(external)?'READY':external?'DEGRADED':'NOT_READY',
      workerStatus:runtime.workerStatus as 'IDLE'|'RUNNING'|'DEGRADED',lastSuccessfulBackup:runtime.lastSuccessfulBackupAt?.toISOString()??null,
      lastVerifiedBackup:latest?this.record(latest):null,lastFailure:runtime.lastFailureCode,recoveryKeyAvailable:Boolean(floor.recoveryKey),
      recoveryKeyExported:Boolean(floor.recoveryKeyExportedAt),recoveryPreparedness:
        floor.recoveryState==='NORMAL'&&current(local)&&current(external)&&floor.offDeviceDirectory&&
        floor.recoveryKey&&floor.recoveryKeyExportedAt&&runtime.workerStatus!=='DEGRADED'?'READY':latest?'DEGRADED':'NOT_READY',
      nextPeriodicBackupAt:runtime.nextPeriodicBackupAt?.toISOString()??null,recentBackups:records.slice(0,20).map(r=>this.record(r))};
  }

  async exportRecoveryKey(commandId:string,actor:AuthenticatedActor,now=new Date()){
    const floor=await this.securityStore.mutate(current=>{
      if(current.recoveryState!=='NORMAL')throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery is in progress.');
      if(!current.recoveryKey)throw new AppError('RECOVERY_KEY_INVALID',503,'Recovery Key is unavailable.');
      if(current.recoveryKeyExportedAt)throw new AppError('RECOVERY_KEY_ALREADY_EXPORTED',409,'Recovery Key has already been exported.');
      return updateRecoverySecurityFloor(current,{recoveryKeyExportedAt:now.toISOString()});});
    this.audit('RECOVERY_KEY_EXPORTED',this.context.edgeId,actor,commandId,'Recovery Key exportada para custodia externa.',now);
    return {recoveryKey:floor.recoveryKey!};
  }

  async configureOffDevice(directoryPath:string,commandId:string,actor:AuthenticatedActor){
    const path=resolve(directoryPath);if(path===resolve(this.localDirectory))
      throw new AppError('BACKUP_DESTINATION_UNAVAILABLE',409,'Off-device destination must differ from the local backup directory.');
    try{await mkdir(path,{recursive:true});}
    catch(error){this.log.warn({code:safeCode(error,'BACKUP_DESTINATION_UNAVAILABLE')},'Off-device backup destination is unavailable');
      throw new AppError('BACKUP_DESTINATION_UNAVAILABLE',409,'Off-device backup destination is unavailable.');}
    await this.securityStore.mutate(floor=>{
      if(floor.recoveryState!=='NORMAL')throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery is in progress.');
      return updateRecoverySecurityFloor(floor,{offDeviceDirectory:path});});
    this.audit('BACKUP_REQUESTED',this.context.edgeId,actor,commandId,'Destino off-device configurado.',new Date());
    return this.status();
  }

  auditRecovery(action:'RECOVERY_INITIATED'|'RECOVERY_FAILED',backupId:string,
    actor:AuthenticatedActor|null,commandId:string,reason:string,occurredAt=new Date()){
    this.audit(action,backupId,actor,commandId,reason,occurredAt);
  }

  async runPeriodicIfDue(now=new Date()):Promise<void>{const runtime=this.repository.runtime();if(runtime.nextPeriodicBackupAt&&runtime.nextPeriodicBackupAt>now)return;
    await this.create({commandId:EntityId.generate().toString(),destinationType:'LOCAL',trigger:'PERIODIC',actor:null,now}).catch(()=>undefined);
    const floor=await this.securityStore.load();
    if(floor.offDeviceDirectory)await this.create({commandId:EntityId.generate().toString(),destinationType:'OFF_DEVICE',trigger:'PERIODIC',actor:null,now}).catch(()=>undefined);}

  private async applyRetention(destination:string):Promise<void>{
    const verified=this.repository.list(500).filter(r=>r.status==='VERIFIED'&&dirname(r.artifactPath)===resolve(destination));
    if(verified.length<=1)return;const keep=selectRetainedBackupIds(verified,
      this.protectedRecoveryBackupId?[this.protectedRecoveryBackupId]:[]);
    for(const row of verified){if(keep.has(row.backupId))continue;this.repository.markDeleted(row.backupId);await rm(row.artifactPath,{recursive:true,force:true});
      this.audit('BACKUP_RETENTION_DELETED',row.backupId,null,EntityId.generate().toString(),'Backup removed by retention policy.',new Date());}
  }

  private record(row:ReturnType<BackupRepository['get']> extends infer T?Exclude<T,null>:never){return {backupId:row.backupId,status:row.status as any,
    trigger:row.trigger as any,destinationType:row.destinationType as any,createdAt:row.createdAt.toISOString(),
    completedAt:row.completedAt?.toISOString()??null,verifiedAt:row.verifiedAt?.toISOString()??null,
    sizeBytes:row.sizeBytes,failureCode:row.failureCode};}
  private audit(action:any,entityId:string,actor:AuthenticatedActor|null,commandId:string,reason:string,occurredAt:Date){insertAuditEntry(this.db,{auditId:EntityId.generate().toString(),occurredAt,
    tenantId:this.context.tenantId,locationId:this.context.locationId,deviceId:actor?.deviceId??null,sessionId:actor?.sessionId??null,
    actorUserId:actor?.userId??null,actorRole:actor?.roles[0]??null,actorType:actor?'USER':'SYSTEM',source:actor?'ADMIN_LOCAL':'BACKUP_WORKER',
    authorizedByUserId:null,authorizedByRole:null,action,entityType:action.startsWith('BACKUP')?'BACKUP':'RECOVERY',entityId,
    outcome:String(action).endsWith('FAILED')?'REJECTED':'SUCCESS',reason,
    commandId,before:null,after:null,amountAffected:null,currency:null,eventId:null});}
}

export function selectRetainedBackupIds(records:Array<{backupId:string;createdAt:Date}>,protectedIds:string[]=[]):Set<string>{
  const sorted=[...records].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()),keep=new Set<string>(protectedIds);
  sorted.slice(0,24).forEach(row=>keep.add(row.backupId));
  const daily=new Set<string>(),weekly=new Set<string>();
  for(const row of sorted){const day=row.createdAt.toISOString().slice(0,10);
    if(daily.size<7&&!daily.has(day)){daily.add(day);keep.add(row.backupId);}
    const date=row.createdAt;const week=`${date.getUTCFullYear()}-${Math.floor((date.getTime()-Date.UTC(date.getUTCFullYear(),0,1))/604800000)}`;
    if(weekly.size<4&&!weekly.has(week)){weekly.add(week);keep.add(row.backupId);}}
  if(sorted[0])keep.add(sorted[0].backupId);
  return keep;
}

function safeCode(error:unknown,fallback:string){const value=error instanceof Error?error.message:fallback;return /^[A-Z0-9_]+$/.test(value)?value:fallback;}

export class BackupWorker {private timer:NodeJS.Timeout|null=null;constructor(private manager:BackupManager,private intervalMs=60_000){}
  start(){if(this.timer)return;void this.manager.runPeriodicIfDue();this.timer=setInterval(()=>void this.manager.runPeriodicIfDue(),this.intervalMs);this.timer.unref();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}}
