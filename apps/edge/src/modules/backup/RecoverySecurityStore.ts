import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { assertDocumentBinding, verifyControlDocument, CLOCK_SKEW_TOLERANCE_MS } from '@comanview/licensing';
import type { LicenseDocumentPayload, SignedDocumentEnvelope } from '@comanview/contracts';

const BLOOM_BYTES=8192;
const BLOOM_HASHES=7;

export type RecoveryState='NORMAL'|'RECOVERY_REQUIRED'|'RECOVERY_IN_PROGRESS';
export interface RecoveryUpgradeJournal {
  formatVersion:1;
  fromSchema:13;
  toSchema:14;
  phase:'PREPARING'|'SNAPSHOT_READY';
  databasePath:string;
  snapshotId:string;
  snapshotPath:string;
  migrationHash:string;
}
export interface RecoveryJournal {
  recoveryId:string;
  commandId:string;
  backupId:string;
  artifactPath:string;
  phase:'PREPARING'|'QUIESCED'|'SWAPPED'|'VALIDATING';
  startedAt:string;
  originalDatabasePath:string|null;
  stagedDatabasePath:string|null;
  /** SHA-256 of the verified, synced staging file; absent legacy journals fail closed. */
  stagedDatabaseSha256?:string;
  nextRecoveryEpoch:number;
  authorizationId:string|null;
  targetBinding:{tenantId:string;locationId:string;edgeId:string};
  enteredFromRecoveryRequired:boolean;
}
export interface RecoverySecurityFloor {
  formatVersion:1;
  installationEstablished:boolean;
  binding:{tenantId:string;locationId:string;edgeId:string}|null;
  recoveryEpoch:number;
  minimumSchemaVersion?:14;
  maximumSignedRevisions:{LICENSE:number;FEATURE_FLAGS:number;CONFIGURATION:number};
  stickyDeclaredState:'SUSPENDED'|'TERMINATED'|null;
  /** Last cryptographically authorized LICENSE decision; no operational document. */
  licenseDecision?:{revision:number;documentHash:string;stickyDeclaredState:'SUSPENDED'|'TERMINATED'|null};
  licensePending?:{revision:number;documentHash:string}|null;
  revokedDeviceBloom:string;
  recoveryState:RecoveryState;
  recoveryKey:string|null;
  recoveryKeyExportedAt:string|null;
  offDeviceDirectory:string|null;
  journal:RecoveryJournal|null;
  upgradeJournal?:RecoveryUpgradeJournal|null;
  pendingRecoveryAuthorizationAck:{authorizationId:string;commandId:string;consumedAt:string}|null;
  pendingRecoveryFailure:{commandId:string;backupId:string;occurredAt:string;code:string}|null;
  pendingRecoveryAudit:{recoveryId:string;commandId:string;backupId:string;startedAt:string;completedAt:string;
    enteredFromRecoveryRequired:boolean}|null;
  checksum:string;
}

export interface RecoverySecurityStore {
  load():Promise<RecoverySecurityFloor>;
  /** Synchronous transformation of the latest state, under the persistence lock. */
  mutate(change:(current:RecoverySecurityFloor)=>RecoverySecurityFloor):Promise<RecoverySecurityFloor>;
  /** Compare-and-swap: derived snapshots must still match their loaded checksum. */
  save(value:RecoverySecurityFloor):Promise<void>;
  /** Cached authenticated policy, invalidated if the durable file changes externally. */
  licensingSnapshot?():RecoverySecurityFloor|null;
}

type LicenseTransition = {envelope:SignedDocumentEnvelope;publicKeyring:Readonly<Record<string,string>>;
  binding:{tenantId:string;locationId:string;edgeId:string};now:Date;
  prepare(payload:LicenseDocumentPayload,documentHash:string):void;
  activate(payload:LicenseDocumentPayload,documentHash:string):void};
const licenseWriters=new WeakMap<RecoverySecurityStore,(input:LicenseTransition)=>Promise<void>>();
/** Only this path can relax sticky state: verification happens again inside the persistence lock. */
export function applySignedLicenseTransition(store:RecoverySecurityStore,input:LicenseTransition){
  const writer=licenseWriters.get(store);if(!writer)throw new Error('LICENSE_SECURITY_STORE_UNSUPPORTED');
  return writer(input);
}
function licenseCandidate(current:RecoverySecurityFloor,input:LicenseTransition){
  const verified=verifyControlDocument(input.envelope,input.publicKeyring),payload=verified.payload;
  if(payload.documentType!=='LICENSE')throw new Error('LICENSE_DOCUMENT_TYPE_INVALID');
  assertDocumentBinding(payload,input.binding);
  if(!current.binding||current.binding.tenantId!==input.binding.tenantId||current.binding.locationId!==input.binding.locationId||current.binding.edgeId!==input.binding.edgeId)
    throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
  if(current.recoveryState!=='NORMAL'||current.journal||current.upgradeJournal)throw new Error('RECOVERY_IN_PROGRESS');
  const now=Math.max(input.now.getTime(),Date.now());
  if(!Number.isFinite(now)||Date.parse(payload.issuedAt)>now+CLOCK_SKEW_TOLERANCE_MS||
    Date.parse(payload.expiresAt)<now||Date.parse(payload.graceUntil)<Date.parse(payload.expiresAt)||
    Date.parse(payload.expiresAt)<=Date.parse(payload.issuedAt))throw new Error('LICENSE_DOCUMENT_TIME_INVALID');
  const sticky=payload.declaredState==='TERMINATED'?'TERMINATED':payload.declaredState==='SUSPENDED'?'SUSPENDED':null;
  if(payload.revision<current.maximumSignedRevisions.LICENSE)throw new Error('LICENSE_BELOW_SECURITY_FLOOR');
  if(payload.revision===current.maximumSignedRevisions.LICENSE&&
    (stickyRank(sticky)<stickyRank(current.stickyDeclaredState)||
      (current.licenseDecision?.revision===payload.revision&&current.licenseDecision.documentHash!==verified.documentHash)))
    throw new Error('LICENSE_SECURITY_DECISION_CONFLICT');
  const next=updateRecoverySecurityFloor(current,{maximumSignedRevisions:{...current.maximumSignedRevisions,LICENSE:payload.revision},
    stickyDeclaredState:sticky,licensePending:null,licenseDecision:{revision:payload.revision,documentHash:verified.documentHash,stickyDeclaredState:sticky}});
  assertCurrent(current,next);assertMonotonic(current,next,true);
  return {next,payload,documentHash:verified.documentHash};
}
const stickyRank=(state:RecoverySecurityFloor['stickyDeclaredState'])=>state==='TERMINATED'?2:state==='SUSPENDED'?1:0;

const origins=new WeakMap<RecoverySecurityFloor,string>();
function derived(previous:RecoverySecurityFloor,next:RecoverySecurityFloor){
  origins.set(next,origins.get(previous)??previous.checksum);return next;
}
const queues=new Map<object|string,Promise<void>>();
async function serialized<T>(key:object|string,work:()=>Promise<T>):Promise<T>{
  const previous=queues.get(key)??Promise.resolve();
  let release!:()=>void;const tail=new Promise<void>(done=>{release=done;});
  queues.set(key,tail);await previous;
  try{return await work();}finally{release();if(queues.get(key)===tail)queues.delete(key);}
}

export class MemoryRecoverySecurityStore implements RecoverySecurityStore {
  private value=emptyRecoverySecurityFloor();
  constructor(){licenseWriters.set(this,input=>serialized(this,async()=>{
    const {next,payload,documentHash}=licenseCandidate(this.value,input);
    if(this.value.licenseDecision?.documentHash===documentHash&&!this.value.licensePending){
      input.prepare(payload,documentHash);input.activate(payload,documentHash);return;
    }
    this.value=updateRecoverySecurityFloor(this.value,{licensePending:{revision:payload.revision,documentHash}});
    input.prepare(payload,documentHash);this.value=structuredClone(next);input.activate(payload,documentHash);
  }));}
  licensingSnapshot(){return structuredClone(this.value);}
  load(){return serialized(this,async()=>structuredClone(this.value));}
  mutate(change:(current:RecoverySecurityFloor)=>RecoverySecurityFloor){return serialized(this,async()=>{
    const next=change(structuredClone(this.value));assertCurrent(this.value,next);assertMonotonic(this.value,next);
    this.value=structuredClone(next);origins.set(next,next.checksum);return next;
  });}
  save(value:RecoverySecurityFloor){return serialized(this,async()=>{
    assertCurrent(this.value,value);assertMonotonic(this.value,value);
    this.value=structuredClone(value);origins.set(value,value.checksum);
  });}
}

export function emptyRecoverySecurityFloor():RecoverySecurityFloor {
  return seal({formatVersion:1,installationEstablished:false,binding:null,recoveryEpoch:0,
    maximumSignedRevisions:{LICENSE:0,FEATURE_FLAGS:0,CONFIGURATION:0},stickyDeclaredState:null,
    revokedDeviceBloom:Buffer.alloc(BLOOM_BYTES).toString('base64url'),recoveryState:'NORMAL',
    recoveryKey:null,recoveryKeyExportedAt:null,offDeviceDirectory:null,journal:null,
    pendingRecoveryAuthorizationAck:null,pendingRecoveryFailure:null,pendingRecoveryAudit:null});
}

export function ensureRecoveryKey(value:RecoverySecurityFloor):{floor:RecoverySecurityFloor;created:boolean} {
  if(value.recoveryKey)return {floor:value,created:false};
  return {floor:derived(value,seal({...withoutChecksum(value),recoveryKey:randomBytes(32).toString('base64url')})),created:true};
}

export function updateRecoverySecurityFloor(value:RecoverySecurityFloor,
  update:Partial<Omit<RecoverySecurityFloor,'formatVersion'|'checksum'>>):RecoverySecurityFloor {
  return derived(value,seal({...withoutChecksum(value),...update}));
}

export function addRevokedDevice(value:RecoverySecurityFloor,deviceId:string):RecoverySecurityFloor {
  const bits=decodeBloom(value.revokedDeviceBloom);
  for(const index of bloomIndexes(deviceId))bits[Math.floor(index/8)]!|=1<<(index%8);
  return derived(value,seal({...withoutChecksum(value),revokedDeviceBloom:bits.toString('base64url')}));
}
export function isDeviceRevokedByFloor(value:RecoverySecurityFloor,deviceId:string):boolean {
  const bits=decodeBloom(value.revokedDeviceBloom);
  return bloomIndexes(deviceId).every((index)=>(bits[Math.floor(index/8)]!&(1<<(index%8)))!==0);
}

export async function initializeRecoverySecurityFloor(input:{
  store:RecoverySecurityStore;
  sqlite:Database.Database;
  binding:{tenantId:string;locationId:string;edgeId:string};
}):Promise<RecoverySecurityFloor>{
  return input.store.mutate(current=>{let floor=current;
  const installation=input.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='edge_installations'").get();
  if(installation){
    const row=input.sqlite.prepare("SELECT recovery_epoch epoch FROM edge_installations WHERE singleton_key='PRIMARY'").get() as {epoch:number}|undefined;
    if(!row||!Number.isSafeInteger(row.epoch)||row.epoch<floor.recoveryEpoch)throw new Error('RECOVERY_EPOCH_ROLLBACK');
    floor=updateRecoverySecurityFloor(floor,{recoveryEpoch:row.epoch,minimumSchemaVersion:14});
  }
  const keyed=ensureRecoveryKey(floor);floor=keyed.floor;
  if(!floor.installationEstablished)floor=updateRecoverySecurityFloor(floor,{
    installationEstablished:true,binding:{...input.binding},recoveryState:'NORMAL'});
  if(!floor.binding||floor.binding.tenantId!==input.binding.tenantId||
    floor.binding.locationId!==input.binding.locationId||floor.binding.edgeId!==input.binding.edgeId)
    throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
  floor=mergeRecoverySecurityMetadata(floor,input.sqlite);
  return floor;
  });
}

/** Monotonic security metadata only; also accepts a verified legacy snapshot. */
export function mergeRecoverySecurityMetadata(floor:RecoverySecurityFloor,sqlite:Database.Database):RecoverySecurityFloor {
  const revoked=sqlite.prepare("SELECT id FROM devices WHERE status='REVOKED'").all() as Array<{id:string}>;
  for(const device of revoked)floor=addRevokedDevice(floor,device.id);
  const revisions=sqlite.prepare(`SELECT document_type documentType,MAX(revision) revision
    FROM edge_control_documents GROUP BY document_type`).all() as
    Array<{documentType:'LICENSE'|'FEATURE_FLAGS'|'CONFIGURATION';revision:number}>;
  const maximum={...floor.maximumSignedRevisions};
  for(const row of revisions){
    if(!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('RECOVERY_SECURITY_REVISION_INVALID');
    // Staged (not current) LICENSE rows are not accepted decisions. A pending
    // preparation also identifies this window before the first revision-bound decision.
    if(row.documentType==='LICENSE'&&(floor.licenseDecision||floor.licensePending))continue;
    maximum[row.documentType]=Math.max(maximum[row.documentType],row.revision);
  }
  const runtime=sqlite.prepare("SELECT sticky_declared_state sticky FROM edge_control_runtime WHERE singleton_key='PRIMARY'").get() as
    {sticky:string|null}|undefined;
  if(!runtime||![null,'ACTIVE','PAST_DUE','GRACE_PERIOD','SUSPENDED','TERMINATED'].includes(runtime.sticky))
    throw new Error('RECOVERY_SECURITY_LICENSING_INVALID');
  // An older snapshot's commercial state cannot supersede an authorized newer decision.
  const decision=floor.licenseDecision;
  const obsoleteRuntime=decision&&decision.revision===floor.maximumSignedRevisions.LICENSE&&
    maximum.LICENSE<=decision.revision;
  floor=updateRecoverySecurityFloor(floor,{maximumSignedRevisions:maximum,
    stickyDeclaredState:obsoleteRuntime?floor.stickyDeclaredState:
      runtime?.sticky==='TERMINATED'||floor.stickyDeclaredState==='TERMINATED'?'TERMINATED':
      runtime?.sticky==='SUSPENDED'||floor.stickyDeclaredState==='SUSPENDED'?'SUSPENDED':null});
  return floor;
}

abstract class FileRecoverySecurityStore implements RecoverySecurityStore {
  private cached:{floor:RecoverySecurityFloor;hash:string}|null=null;
  constructor(protected readonly path:string){licenseWriters.set(this,input=>this.exclusive(async()=>{
    const current=await this.readUnlocked(),{next,payload,documentHash}=licenseCandidate(current,input);
    if(current.licenseDecision?.documentHash===documentHash&&!current.licensePending){
      input.prepare(payload,documentHash);input.activate(payload,documentHash);return;
    }
    await this.writeUnlocked(updateRecoverySecurityFloor(current,{licensePending:{revision:payload.revision,documentHash}}));
    input.prepare(payload,documentHash);await this.writeUnlocked(next);input.activate(payload,documentHash);
  }));}
  licensingSnapshot(){try{
    return this.cached&&createHash('sha256').update(readFileSync(this.path)).digest('hex')===this.cached.hash?
      structuredClone(this.cached.floor):null;
  }catch{return null;}}
  private async exclusive<T>(work:()=>Promise<T>):Promise<T>{
    await mkdir(dirname(resolve(this.path)),{recursive:true});
    const info=await lstat(this.path).catch((error:NodeJS.ErrnoException)=>{
      if(error.code==='ENOENT')return null;throw error;});
    if(info&&(info.isSymbolicLink()||info.nlink!==1))throw new Error('RECOVERY_SECURITY_PATH_INVALID');
    const canonical=join(await realpath(dirname(resolve(this.path))),basename(this.path));
    const key=process.platform==='win32'?canonical.toLowerCase():canonical;
    return serialized(key,async()=>{
      await mkdir(dirname(this.path),{recursive:true});
      // Same options for every writer. Abandoned locks become retryable; a
      // compromised live lease throws (fail-closed), never last-write-wins.
      const release=await lockfile.lock(key,{realpath:false,stale:30_000,update:10_000,
        retries:{retries:20,factor:1,minTimeout:50,maxTimeout:50}})
        .catch(()=>{throw new Error('RECOVERY_SECURITY_LOCKED');});
      try{return await work();}finally{await release();}
    });
  }
  load():Promise<RecoverySecurityFloor>{return this.exclusive(()=>this.readUnlocked());}
  mutate(change:(current:RecoverySecurityFloor)=>RecoverySecurityFloor):Promise<RecoverySecurityFloor>{
    return this.exclusive(async()=>{const current=await this.readUnlocked(),next=change(structuredClone(current));
      assertCurrent(current,next);assertMonotonic(current,next);await this.writeUnlocked(next);origins.set(next,next.checksum);return next;});
  }
  save(value:RecoverySecurityFloor):Promise<void>{return this.exclusive(async()=>{
    const current=await this.readUnlocked();assertCurrent(current,value);assertMonotonic(current,value);
    await this.writeUnlocked(value);origins.set(value,value.checksum);
  });}
  private async readUnlocked():Promise<RecoverySecurityFloor>{
    try{const bytes=await readFile(this.path),floor=validate(JSON.parse((await this.decode(bytes)).toString('utf8')));
      this.cached={floor:structuredClone(floor),hash:createHash('sha256').update(bytes).digest('hex')};return floor;}
    catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return emptyRecoverySecurityFloor();
      const preserved=`${this.path}.corrupt-${Date.now()}-${process.pid}`;
      await rename(this.path,preserved);
      const floor=updateRecoverySecurityFloor(emptyRecoverySecurityFloor(),{
        installationEstablished:true,recoveryState:'RECOVERY_REQUIRED'});
      await this.writeUnlocked(floor);return floor;
    }
  }
  private async writeUnlocked(value:RecoverySecurityFloor):Promise<void>{
    this.cached=null;
    const checked=validate(value);await mkdir(dirname(this.path),{recursive:true});
    const temporary=`${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try{const bytes=await this.encode(Buffer.from(JSON.stringify(checked),'utf8'));
      const handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(bytes);await handle.sync();}
      finally{await handle.close();}
      await rename(temporary,this.path);await this.protectFile();
      this.cached={floor:structuredClone(checked),hash:createHash('sha256').update(bytes).digest('hex')};}
    finally{await unlink(temporary).catch(()=>undefined);}
  }
  protected abstract encode(value:Buffer):Promise<Buffer>;
  protected abstract decode(value:Buffer):Promise<Buffer>;
  protected async protectFile():Promise<void>{}
}

function assertCurrent(current:RecoverySecurityFloor,next:RecoverySecurityFloor){
  validate(next);
  if((origins.get(next)??next.checksum)!==current.checksum)
    throw new Error('RECOVERY_SECURITY_STALE_WRITE');
}
function assertMonotonic(current:RecoverySecurityFloor,next:RecoverySecurityFloor,authorizedLicense=false){
  validate(next);
  if(current.binding&&(!next.binding||current.binding.edgeId!==next.binding.edgeId||
    current.binding.tenantId!==next.binding.tenantId||current.binding.locationId!==next.binding.locationId))
    throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
  if(!authorizedLicense&&JSON.stringify(current.licenseDecision)!==JSON.stringify(next.licenseDecision))
    throw new Error('RECOVERY_SECURITY_LICENSE_DECISION_PROTECTED');
  if(!authorizedLicense&&JSON.stringify(current.licensePending)!==JSON.stringify(next.licensePending))
    throw new Error('RECOVERY_SECURITY_LICENSE_DECISION_PROTECTED');
  const before=decodeBloom(current.revokedDeviceBloom),after=decodeBloom(next.revokedDeviceBloom);
  if(next.recoveryEpoch<current.recoveryEpoch||
    (current.installationEstablished&&!next.installationEstablished)||
    (current.minimumSchemaVersion===14&&next.minimumSchemaVersion!==14)||
    (stickyRank(next.stickyDeclaredState)<stickyRank(current.stickyDeclaredState)&&
      !(authorizedLicense&&next.maximumSignedRevisions.LICENSE>current.maximumSignedRevisions.LICENSE))||
    Object.keys(current.maximumSignedRevisions).some(type=>next.maximumSignedRevisions[type as keyof typeof current.maximumSignedRevisions]<current.maximumSignedRevisions[type as keyof typeof current.maximumSignedRevisions])||
    before.some((bits,index)=>(bits&after[index]!)!==bits)||
    (current.recoveryKey!==null&&next.recoveryKey!==current.recoveryKey)||
    (current.recoveryKeyExportedAt!==null&&next.recoveryKeyExportedAt!==current.recoveryKeyExportedAt))
    throw new Error('RECOVERY_SECURITY_ROLLBACK');
}

export class DevelopmentRecoverySecurityStore extends FileRecoverySecurityStore {
  protected encode(value:Buffer){return Promise.resolve(value);}
  protected decode(value:Buffer){return Promise.resolve(value);}
}
export class WindowsDpapiRecoverySecurityStore extends FileRecoverySecurityStore {
  constructor(path:string){super(path);if(process.platform!=='win32')throw new Error('Windows DPAPI recovery storage requires Windows.');}
  protected encode(value:Buffer){return invokeDpapi('Protect',value);}
  protected decode(value:Buffer){return invokeDpapi('Unprotect',value);}
  protected override async protectFile(){
    const script=`$p=[Console]::In.ReadToEnd();$id=[System.Security.Principal.WindowsIdentity]::GetCurrent();`+
      `$acl=New-Object System.Security.AccessControl.FileSecurity;$acl.SetOwner($id.User);`+
      `$acl.SetAccessRuleProtection($true,$false);$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id.User,'FullControl','Allow');`+
      `$acl.AddAccessRule($rule);[System.IO.File]::SetAccessControl($p,$acl)`;
    await execPowerShell(script,Buffer.from(this.path,'utf8'));
  }
}

export function createRecoverySecurityStore(environment:NodeJS.ProcessEnv=process.env):RecoverySecurityStore {
  const mode=environment['COMANVIEW_RECOVERY_SECURITY_STORE']??
    (environment['NODE_ENV']==='production'?'windows-dpapi':'development-file');
  const path=environment['COMANVIEW_RECOVERY_SECURITY_PATH']?.trim()||'.comanview/recovery-security.bin';
  if(environment['NODE_ENV']==='production'&&mode!=='windows-dpapi')
    throw new Error('Production recovery security state requires Windows DPAPI.');
  if(mode==='development-file')return new DevelopmentRecoverySecurityStore(path);
  if(mode==='windows-dpapi')return new WindowsDpapiRecoverySecurityStore(path);
  throw new Error('Unsupported COMANVIEW_RECOVERY_SECURITY_STORE.');
}

function seal(input:Omit<RecoverySecurityFloor,'checksum'>):RecoverySecurityFloor {
  return {...input,checksum:checksum(input)};
}
function withoutChecksum(value:RecoverySecurityFloor):Omit<RecoverySecurityFloor,'checksum'>{
  const {checksum:ignored,...rest}=value;void ignored;return rest;
}
function checksum(value:unknown){return createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');}
function validate(input:unknown):RecoverySecurityFloor {
  if(!input||typeof input!=='object')throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  const value=input as RecoverySecurityFloor;
  if(value.formatVersion!==1||typeof value.installationEstablished!=='boolean'||
    !Number.isInteger(value.recoveryEpoch)||value.recoveryEpoch<0||
    !['NORMAL','RECOVERY_REQUIRED','RECOVERY_IN_PROGRESS'].includes(value.recoveryState)||
    typeof value.checksum!=='string'||checksum(withoutChecksum(value))!==value.checksum)
    throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  decodeBloom(value.revokedDeviceBloom);
  if(value.minimumSchemaVersion!==undefined&&value.minimumSchemaVersion!==14)throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  if(value.licensePending&&(!Number.isSafeInteger(value.licensePending.revision)||value.licensePending.revision<=0||
    !/^[a-f0-9]{64}$/.test(value.licensePending.documentHash)))throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  if(value.licenseDecision&&(!Number.isSafeInteger(value.licenseDecision.revision)||value.licenseDecision.revision<=0||
    value.licenseDecision.revision>value.maximumSignedRevisions.LICENSE||!/^[a-f0-9]{64}$/.test(value.licenseDecision.documentHash)||
    ![null,'SUSPENDED','TERMINATED'].includes(value.licenseDecision.stickyDeclaredState)))throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  if(!value.maximumSignedRevisions||!['LICENSE','FEATURE_FLAGS','CONFIGURATION'].every(type=>{
    const revision=value.maximumSignedRevisions[type as keyof typeof value.maximumSignedRevisions];
    return Number.isSafeInteger(revision)&&revision>=0;
  })||![null,'SUSPENDED','TERMINATED'].includes(value.stickyDeclaredState))throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  if(value.upgradeJournal){const j=value.upgradeJournal;
    if(j.formatVersion!==1||j.fromSchema!==13||j.toSchema!==14||!['PREPARING','SNAPSHOT_READY'].includes(j.phase)||
      ![j.databasePath,j.snapshotId,j.snapshotPath,j.migrationHash].every(x=>typeof x==='string'&&x.length>0)||
      !/^[a-f0-9]{64}$/.test(j.migrationHash)||!value.installationEstablished||!value.binding||
      value.recoveryState!=='RECOVERY_IN_PROGRESS'||value.journal)throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  }
  if(value.recoveryKey!==null&&Buffer.from(value.recoveryKey,'base64url').length!==32)
    throw new Error('RECOVERY_SECURITY_STATE_INVALID');
  if(!('pendingRecoveryFailure' in value))return seal({...withoutChecksum(value),pendingRecoveryFailure:null});
  return value;
}
function decodeBloom(value:string){const result=Buffer.from(value,'base64url');if(result.length!==BLOOM_BYTES)throw new Error('RECOVERY_SECURITY_STATE_INVALID');return result;}
function bloomIndexes(value:string):number[]{
  const digest=createHash('sha512').update(`comanview-revoked-device:${value}`,'utf8').digest();
  return Array.from({length:BLOOM_HASHES},(_,index)=>digest.readUInt32BE(index*4)%(BLOOM_BYTES*8));
}
async function invokeDpapi(operation:'Protect'|'Unprotect',input:Buffer):Promise<Buffer>{
  const script=`Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());`+
    `$o=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);`+
    `[Console]::Out.Write([Convert]::ToBase64String($o))`;
  const output=await execPowerShell(script,Buffer.from(input.toString('base64'),'utf8'));
  return Buffer.from(output.toString('utf8').trim(),'base64');
}
function execPowerShell(script:string,stdin:Buffer):Promise<Buffer>{
  return new Promise((resolve,reject)=>{const child=execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],
    {encoding:'buffer',windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin?.end(stdin);});
}
