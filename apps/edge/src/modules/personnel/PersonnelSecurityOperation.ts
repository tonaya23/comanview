import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { BASE_ROLE_PERMISSIONS, hashOperationalPin, verifyOperationalPin, verifyDeviceCredential, type BaseRole } from '@comanview/auth';
import { CompleteOwnerRecoveryRequestSchema,CompleteBootstrapRequestSchema,PersonnelMutationSchema,type PersonnelMutation,type CompleteOwnerRecoveryRequest } from '@comanview/contracts';
export { PersonnelMutationSchema,type PersonnelMutation } from '@comanview/contracts';
import { verifyOwnerRecoveryAuthorization,verifyInstallationAuthorization,hashPairingCode } from '@comanview/licensing';
import type { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { EntityId } from '@comanview/domain';
import { AuthRepository, administrationMigrationDigest, inspectAdministrationSchema, insertAuditEntry } from '@comanview/database';
import { resolve } from 'node:path';
import * as edgeSchema from '@comanview/database/edge';
import { verifyEncryptedBackupArtifact } from '../backup/BackupArtifact.js';
import { updateRecoverySecurityFloor, isDeviceRevokedByFloor, type RecoverySecurityFloor } from '../backup/RecoverySecurityStore.js';
import { PersonnelSecurityFloorSchema, personnelRestrictions, personnelSessionIsCurrent, nextPersonnelRevisions,
  personnelTransitionDigest, assertPersonnelReceipt, PersonnelTransitionDescriptorSchema,
  type PersonnelTransitionDescriptor, type PersonnelSecurityFloor, type StoredPersonnelSecurity } from './PersonnelSecurityModel.js';

const Id = z.string().uuid();
const Roles = z.array(z.enum(['OWNER','MANAGER','CASHIER','WAITER','KITCHEN'])).min(1).max(5)
  .refine(roles => new Set(roles).size === roles.length);
export type PersonnelSecurityOperation =
  | { kind:'BASELINE'; sqlite:Database.Database }
  | { kind:'RESTORE'; sqlite:Database.Database }
  | { kind:'BOOTSTRAP_OWNER';sqlite:Database.Database;request:z.infer<typeof CompleteBootstrapRequestSchema>;publicKeyring:Readonly<Record<string,string>>;licensing:EdgeLicenseManager }
  | { kind:'OWNER_CHALLENGE';sqlite:Database.Database;deviceId:string;deviceCredential:string;pairingId:string|null;requestToken?:string }
  | { kind:'RECOVER_OWNER';sqlite:Database.Database;request:CompleteOwnerRecoveryRequest;publicKeyring:Readonly<Record<string,string>>;licensing:EdgeLicenseManager }
  | { kind:'ACK_OWNER_RECOVERY';sqlite:Database.Database;authorizationId:string }
  | { kind:'MUTATE'; sqlite:Database.Database; sessionId:string; command:PersonnelMutation }
  | { kind:'RECONCILE'; sqlite:Database.Database };
type Persist = (next:RecoverySecurityFloor)=>Promise<void>;
type User = StoredPersonnelSecurity & { displayName:string; pinHash:string; version:number };
type Intent = { transitionId:string; descriptor:string; digest:string; payload:string; state:string; epoch:number };
const fields = 'id AS userId,display_name AS displayName,pin_hash AS pinHash,status,version,trust_domain_id AS trustDomainId,credential_revision AS credentialRevision,authorization_revision AS authorizationRevision';
const privatePayloadSchema = z.object({ displayName:z.string(),pinHash:z.string(),roles:z.array(z.string()),status:z.enum(['ACTIVE','DISABLED']),
  actorUserId:Id,deviceId:Id,sessionId:Id.nullable(),reason:z.string(),targetVersion:z.number().int().safe().positive(),
  ownerRecovery:z.object({authorizationId:Id,pairingId:Id.nullable(),credentialId:Id,credentialHash:z.string(),consumedAt:z.number().int().safe(),ackCommandId:Id}).strict().optional(),
  bootstrap:z.object({authorizationId:Id,pairingId:Id,credentialId:Id,credentialHash:z.string(),ackCommandId:Id}).strict().optional() }).strict();
type PrivatePayload = z.infer<typeof privatePayloadSchema>;

function binding(db:Database.Database,floor:RecoverySecurityFloor){
  const row=db.prepare("SELECT edge_id AS edgeId,tenant_id AS tenantId,location_id AS locationId,recovery_epoch AS epoch FROM edge_installations WHERE singleton_key='PRIMARY'").get() as
    {edgeId:string;tenantId:string;locationId:string;epoch:number}|undefined;
  if(!row||!floor.binding||row.epoch!==floor.recoveryEpoch||row.edgeId!==floor.binding.edgeId||
    row.tenantId!==floor.binding.tenantId||row.locationId!==floor.binding.locationId)throw new Error('PERSONNEL_BINDING_MISMATCH');
  if(db.prepare('SELECT 1 FROM users WHERE tenant_id!=? OR location_id!=? LIMIT 1').get(row.tenantId,row.locationId))
    throw new Error('PERSONNEL_BINDING_MISMATCH');
  return row;
}
function users(db:Database.Database):User[]{return db.prepare(`SELECT ${fields} FROM users ORDER BY id`).all() as User[];}
function roles(db:Database.Database,userId:string):Array<{id:string;name:BaseRole}>{
  return db.prepare('SELECT r.id,r.name FROM user_roles u JOIN roles r ON r.id=u.role_id WHERE u.user_id=? ORDER BY r.id').all(userId) as Array<{id:string;name:BaseRole}>;
}
function revisionedRows(db:Database.Database){return db.prepare('SELECT id,tenant_id,location_id,display_name,pin_hash,status,created_at FROM users ORDER BY id').all();}
function baselineDigest(ids:string[]){return createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');}

/** Only invoked by the registered SecurityStore writer, with its interprocess lock held.
 * SQLite and the floor have separate durable boundaries; this does not claim shared ACID.
 */
export async function executePersonnelSecurityOperation(input:PersonnelSecurityOperation,current:RecoverySecurityFloor,persist:Persist):Promise<void>{
  const db=input.sqlite;binding(db,current);
  if(input.kind==='BASELINE'){await baseline(db,current,persist);return;}
  if(input.kind==='RESTORE'){await restoredPersonnel(db,current,persist);return;}
  if(current.recoveryState!=='NORMAL'||current.journal||current.upgradeJournal||current.administrationUpgradeJournal)
    throw new Error('RECOVERY_IN_PROGRESS');
  if(!current.personnel||current.personnel.initializationState!=='ACTIVE')throw new Error('PERSONNEL_SECURITY_NOT_INITIALIZED');
  if(input.kind==='BOOTSTRAP_OWNER'){await bootstrapOwner(db,current,input,persist);return;}
  if(input.kind==='OWNER_CHALLENGE'){
    if(!current.personnel.recoveryContext||trustedOwner(db,current))throw new Error('OWNER_RECOVERY_NOT_REQUIRED');
    proveDevice(db,current,input);
    const personnel={...current.personnel,ownerRecoveryAccess:{...current.personnel.ownerRecoveryAccess,
      generation:current.personnel.ownerRecoveryAccess.generation+1,challenge:{challengeId:EntityId.generate().toString(),deviceId:input.deviceId,pairingId:input.pairingId}}};
    await persist(updateRecoverySecurityFloor(current,{personnel}));return;
  }
  if(input.kind==='RECOVER_OWNER'){await recoverOwner(db,current,input,persist);return;}
  if(input.kind==='ACK_OWNER_RECOVERY'){
    const pending=current.personnel.ownerRecoveryAccess.pendingConsumption;
    if(!pending||pending.authorizationId!==input.authorizationId)return;
    if(!db.prepare('SELECT 1 FROM owner_recovery_acknowledgements WHERE authorization_id=? AND transition_id=? AND acknowledged_at IS NOT NULL')
      .get(input.authorizationId,pending.transitionId))throw new Error('OWNER_RECOVERY_ACK_INVALID');
    await persist(updateRecoverySecurityFloor(current,{personnel:{...current.personnel,ownerRecoveryAccess:{...current.personnel.ownerRecoveryAccess,pendingConsumption:null}}}));return;
  }
  if(input.kind==='RECONCILE'){
    for(const [userId,entry] of Object.entries(current.personnel.users)){
      if(!entry.pending)continue;
      const intent=readIntent(db,entry.pending.transitionId);
      if(!intent)continue; // Selective repair required: never invent a lost PIN/payload.
      try{current=await resume(db,current,intent,persist);}
      catch(error){
        if(error instanceof z.ZodError||error instanceof SyntaxError||
          (error instanceof Error&&error.message==='USER_SECURITY_RECEIPT_MISMATCH'))continue;
        throw error;
      }
      if(current.personnel!.users[userId]!.pending)throw new Error('USER_SECURITY_REPAIR_REQUIRED');
    }
    return;
  }
  const command=PersonnelMutationSchema.parse(input.command);
  if((command.roles&&!['ENROLL','CHANGE_AUTHORIZATION','REENABLE','RESOLVE_RESTORED_USER','REPAIR'].includes(command.kind))||
    (command.status&&!['RESOLVE_RESTORED_USER','REPAIR'].includes(command.kind))||
    (command.newPin&&!['ENROLL','ROTATE_CREDENTIAL','REENABLE','RESOLVE_RESTORED_USER','REPAIR'].includes(command.kind))||
    (command.displayName&&!['ENROLL','RENAME'].includes(command.kind))||
    (command.oldPin&&command.kind!=='ROTATE_CREDENTIAL'))throw new Error('PERSONNEL_COMMAND_FIELDS_INVALID');
  if(['ENROLL','ROTATE_CREDENTIAL','REENABLE','REPAIR'].includes(command.kind)&&!command.newPin)throw new Error('PERSONNEL_NEW_PIN_REQUIRED');
  if(db.inTransaction)throw new Error('PERSONNEL_TRANSACTION_ALREADY_OPEN');
  db.exec('BEGIN IMMEDIATE');
  try{
    const scope=binding(db,current),floor=current.personnel;
    const session=db.prepare(`SELECT user_id AS userId,device_id AS deviceId,trust_domain_id AS trustDomainId,
      credential_revision AS credentialRevision,authorization_revision AS authorizationRevision,session_revision AS sessionRevision,
      issued_recovery_epoch AS issuedRecoveryEpoch FROM auth_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>? AND tenant_id=? AND location_id=?`)
      .get(input.sessionId,Date.now(),scope.tenantId,scope.locationId) as {userId:string;deviceId:string;trustDomainId:string;credentialRevision:number;authorizationRevision:number;sessionRevision:number;issuedRecoveryEpoch:number}|undefined;
    const actor=session?users(db).find(u=>u.userId===session.userId):undefined;
    if(!actor||!session||!personnelSessionIsCurrent(floor,actor,session,current.recoveryEpoch)||
      isDeviceRevokedByFloor(current,session.deviceId)||!db.prepare("SELECT id FROM devices WHERE id=? AND status='ACTIVE' AND tenant_id=? AND location_id=?").get(session.deviceId,scope.tenantId,scope.locationId))
      throw new Error('AUTH_SESSION_INVALID');
    const authenticated=new AuthRepository(drizzle(db,{schema:edgeSchema})).findValidSessionById(input.sessionId,new Date());
    if(!authenticated)throw new Error('AUTH_SESSION_INVALID');
    const permissions=new Set(authenticated.permissions);
    const self=actor.userId===command.userId;
    if(!permissions.has(self&&command.kind==='ROTATE_CREDENTIAL'?'OWN_PIN_CHANGE':'PERSONNEL_MANAGE'))throw new Error('PERMISSION_DENIED');
    const oldIntent=db.prepare('SELECT transition_id AS transitionId,descriptor_json AS descriptor,transition_digest AS digest,private_payload_json AS payload,state,recovery_epoch AS epoch FROM personnel_security_intents WHERE command_id=?')
      .get(command.commandId) as Intent|undefined;
    if(oldIntent){
      const descriptor=PersonnelTransitionDescriptorSchema.parse(JSON.parse(oldIntent.descriptor));
      const payload=privatePayloadSchema.parse(JSON.parse(oldIntent.payload));
      if(descriptor.userId!==command.userId||descriptor.kind!==command.kind||oldIntent.epoch!==current.recoveryEpoch||
        descriptor.authority.kind!=='USER'||descriptor.authority.userId!==actor.userId||
        payload.targetVersion!==command.expectedVersion+1||payload.reason!==command.reason||
        (command.status&&command.status!==payload.status)||(command.displayName&&command.displayName!==payload.displayName)||
        (command.roles&&JSON.stringify(command.roles.map(name=>(db.prepare('SELECT id FROM roles WHERE name=?').get(name) as {id:string}).id).sort())!==JSON.stringify(payload.roles))||
        (command.newPin&&!await verifyOperationalPin(command.newPin,payload.pinHash)))throw new Error('COMMAND_ID_CONFLICT');
      db.exec('COMMIT');
      if(current.personnel.users[command.userId]?.pending?.transitionId===oldIntent.transitionId)await resume(db,current,oldIntent,persist);
      else if(oldIntent.state!=='APPLIED')throw new Error('USER_SECURITY_REPAIR_REQUIRED');
      return;
    }
    if(db.prepare('SELECT 1 FROM processed_commands WHERE command_id=?').get(command.commandId))throw new Error('COMMAND_ID_CONFLICT');
    const existing=users(db).find(u=>u.userId===command.userId);
    if(command.kind==='ENROLL'?(Boolean(existing)||command.expectedVersion!==0):(!existing||existing.version!==command.expectedVersion))
      throw new Error('PERSONNEL_VERSION_CONFLICT');
    const previous=floor.users[command.userId];
    const targetRoles=command.roles??(existing?roles(db,existing.userId).map(r=>r.name):[]);
    Roles.parse(targetRoles);
    const oldRoles=existing?roles(db,existing.userId):[];
    if(!(self&&command.kind==='ROTATE_CREDENTIAL')&&(targetRoles.some(r=>r==='OWNER'||r==='MANAGER')||oldRoles.some(r=>r.name==='OWNER'||r.name==='MANAGER'))&&
      !permissions.has('PERSONNEL_PRIVILEGED_MANAGE'))throw new Error('PERSONNEL_PRIVILEGED_PERMISSION_REQUIRED');
    const repairing=command.kind==='REPAIR'||command.kind==='RESOLVE_RESTORED_USER';
    if(repairing&&!permissions.has('PERSONNEL_RECOVERY'))throw new Error('PERSONNEL_RECOVERY_PERMISSION_REQUIRED');
    if(previous?.pending&&!repairing)throw new Error('USER_SECURITY_REPAIR_REQUIRED');
    const restrictions=existing?personnelRestrictions(floor,existing).filter(r=>r!=='USER_DISABLED'):[];
    if(restrictions.length&&!repairing&&!(command.kind==='ROTATE_CREDENTIAL'&&restrictions.every(r=>r==='CREDENTIAL_RESET_REQUIRED')))
      throw new Error(restrictions[0]);
    const status=command.kind==='DISABLE'?'DISABLED':command.kind==='REENABLE'||command.kind==='ENROLL'?'ACTIVE':command.status??existing?.status??'ACTIVE';
    if(self&&status==='DISABLED')throw new Error('PERSONNEL_SELF_DISABLE');
    const ownerId=(db.prepare("SELECT initial_owner_user_id AS id FROM installation_state WHERE singleton_key='PRIMARY'").get() as {id:string|null}|undefined)?.id;
    if(ownerId===command.userId&&(status!=='ACTIVE'||!targetRoles.includes('OWNER')))throw new Error('CONTRACTUAL_OWNER_PROTECTED');
    if(existing&&oldRoles.some(r=>r.name==='OWNER')&&(status!=='ACTIVE'||!targetRoles.includes('OWNER'))&&
      !users(db).some(u=>u.userId!==command.userId&&personnelRestrictions(floor,u).length===0&&roles(db,u.userId).some(r=>r.name==='OWNER')))
      throw new Error('PERSONNEL_LAST_OWNER');
    if(self&&command.kind==='ROTATE_CREDENTIAL'&&(!command.oldPin||!await verifyOperationalPin(command.oldPin,actor.pinHash)))
      throw new Error('INVALID_CREDENTIALS');
    const requiresPin=['ENROLL','ROTATE_CREDENTIAL','REENABLE','REPAIR'].includes(command.kind)||
      (repairing&&(restrictions.includes('CREDENTIAL_RESET_REQUIRED')||restrictions.includes('USER_UNTRUSTED')));
    if(requiresPin&&!command.newPin)throw new Error('PERSONNEL_NEW_PIN_REQUIRED');
    if(repairing&&(!command.roles||!command.status))throw new Error('PERSONNEL_EXPLICIT_REVIEW_REQUIRED');
    if(['ENROLL','RENAME'].includes(command.kind)&&!command.displayName)throw new Error('PERSONNEL_DISPLAY_NAME_REQUIRED');
    if(command.newPin){
      for(const user of users(db))if(await verifyOperationalPin(command.newPin,user.pinHash))
        throw new Error(user.userId===command.userId?'PERSONNEL_NEW_PIN_REQUIRED':'PERSONNEL_PIN_NOT_UNIQUE');
    }
    const from=previous??{credentialRevision:0,authorizationRevision:0,sessionRevision:0};
    let target=command.kind==='RESOLVE_RESTORED_USER'?{
      credentialRevision:from.credentialRevision,authorizationRevision:from.authorizationRevision+1,sessionRevision:from.sessionRevision+1
    }:nextPersonnelRevisions(from,command.kind);
    if(command.newPin)target={...target,credentialRevision:Math.max(target.credentialRevision,from.credentialRevision+1)};
    const selected=targetRoles.map(name=>db.prepare('SELECT id FROM roles WHERE name=?').get(name) as {id:string}|undefined);
    if(selected.some(r=>!r))throw new Error('PERSONNEL_ROLE_ASSIGNMENT_INVALID');
    const descriptor:PersonnelTransitionDescriptor={formatVersion:1,tenantId:scope.tenantId,locationId:scope.locationId,edgeId:scope.edgeId,
      trustDomainId:floor.trustDomainId,userId:command.userId,transitionId:EntityId.generate().toString(),commandId:command.commandId,kind:command.kind,
      authority:{kind:'USER',userId:actor.userId},from:{credentialRevision:from.credentialRevision,authorizationRevision:from.authorizationRevision,sessionRevision:from.sessionRevision},
      target,targetStatus:status,targetRoleIds:selected.map(r=>r!.id).sort(),supersededTransitionId:previous?.pending?.transitionId??null};
    const digest=personnelTransitionDigest(descriptor);
    const payload:PrivatePayload={displayName:command.displayName??existing!.displayName,pinHash:command.newPin?await hashOperationalPin(command.newPin):existing!.pinHash,
      roles:descriptor.targetRoleIds!,status,actorUserId:actor.userId,deviceId:session.deviceId,sessionId:input.sessionId,reason:command.reason,targetVersion:(existing?.version??0)+1};
    privatePayloadSchema.parse(payload);
    const reserved=updateRecoverySecurityFloor(current,{personnel:{...floor,users:{...floor.users,[command.userId]:{...target,
      pending:{transitionId:descriptor.transitionId,commandId:command.commandId,kind:command.kind,authority:descriptor.authority,transitionDigest:digest}}}}});
    await persist(reserved);current=reserved;
    db.prepare(`INSERT INTO personnel_security_intents(transition_id,command_id,user_id,trust_domain_id,recovery_epoch,transition_digest,descriptor_json,private_payload_json,state,created_at)
      VALUES(?,?,?,?,?,?,?,?,'PREPARED',?)`).run(descriptor.transitionId,command.commandId,command.userId,floor.trustDomainId,current.recoveryEpoch,digest,JSON.stringify(descriptor),JSON.stringify(payload),Date.now());
    db.exec('COMMIT');
    await resume(db,current,readIntent(db,descriptor.transitionId)!,persist);
  }finally{if(db.inTransaction)db.exec('ROLLBACK');}
}

async function restoredPersonnel(db:Database.Database,current:RecoverySecurityFloor,persist:Persist){
  const journal=current.journal;
  if(!journal||journal.phase!=='VALIDATING'||current.recoveryEpoch!==journal.nextRecoveryEpoch||inspectAdministrationSchema(db)!==15)
    throw new Error('PERSONNEL_RESTORE_NOT_AUTHORIZED');
  const receipt=db.prepare("SELECT after_json FROM audit_log WHERE audit_id=? AND action='RECOVERY_VALIDATED' AND outcome='SUCCESS' AND command_id=? AND entity_id=? AND source='RECOVERY_STARTUP'")
    .get(journal.recoveryId,journal.commandId,journal.backupId) as {after_json:string}|undefined;
  const expected={recoveryId:journal.recoveryId,backupId:journal.backupId,stagedDatabaseSha256:journal.stagedDatabaseSha256,
    targetBinding:journal.targetBinding,nextRecoveryEpoch:journal.nextRecoveryEpoch};
  if(!receipt||receipt.after_json!==JSON.stringify(expected))throw new Error('PERSONNEL_RESTORE_NOT_AUTHORIZED');
  if(current.personnel?.recoveryContext?.recoveryId===journal.recoveryId)return;
  if(journal.authorizationId&&!journal.sourceEdgeId)throw new Error('PERSONNEL_RESTORE_SOURCE_AMBIGUOUS');
  const old=current.personnel;
  // Hardware rotates only the trust domain, not historical revision high-water marks.
  // SQLite hashes/roles remain untrusted until an explicit new authorized command.
  const personnel:PersonnelSecurityFloor={formatVersion:1,
    trustDomainId:old&&!journal.authorizationId?old.trustDomainId:EntityId.generate().toString(),initializationState:'ACTIVE',
    users:old?.users??{},ownerRecoveryAccess:{generation:(old?.ownerRecoveryAccess.generation??0)+1,challenge:null,pendingConsumption:null},
    recoveryContext:{recoveryId:journal.recoveryId,backupId:journal.backupId,sourceEdgeId:journal.sourceEdgeId??journal.targetBinding.edgeId,
      targetEdgeId:journal.targetBinding.edgeId,recoveryEpoch:journal.nextRecoveryEpoch,restoreAuthorizationId:journal.authorizationId}};
  await persist(updateRecoverySecurityFloor(current,{personnel,minimumSchemaVersion:15}));
}

function readIntent(db:Database.Database,id:string):Intent|undefined{return db.prepare(`SELECT transition_id AS transitionId,descriptor_json AS descriptor,
  transition_digest AS digest,private_payload_json AS payload,state,recovery_epoch AS epoch FROM personnel_security_intents WHERE transition_id=?`).get(id) as Intent|undefined;}

async function resume(db:Database.Database,floor:RecoverySecurityFloor,intent:Intent,persist:Persist):Promise<RecoverySecurityFloor>{
  const descriptor=PersonnelTransitionDescriptorSchema.parse(JSON.parse(intent.descriptor));
  const payload=privatePayloadSchema.parse(JSON.parse(intent.payload));
  const entry=floor.personnel!.users[descriptor.userId];
  const enrollment=payload.ownerRecovery??payload.bootstrap;
  if(enrollment&&(descriptor.authority.kind==='USER'||descriptor.authority.authorizationId!==enrollment.authorizationId||
    descriptor.authorizedDeviceId!==payload.deviceId||descriptor.authorizedPairingId!==enrollment.pairingId))throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
  if(!entry||intent.epoch!==floor.recoveryEpoch||descriptor.trustDomainId!==floor.personnel!.trustDomainId||
    descriptor.tenantId!==floor.binding!.tenantId||descriptor.locationId!==floor.binding!.locationId||descriptor.edgeId!==floor.binding!.edgeId||
    descriptor.targetStatus!==payload.status||JSON.stringify(descriptor.targetRoleIds)!==JSON.stringify([...payload.roles].sort()))throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
  assertPersonnelReceipt(entry,descriptor,intent.digest);
  if(intent.state==='PREPARED')db.transaction(()=>{
    binding(db,floor);
    if(payload.bootstrap){
      const state=db.prepare("SELECT bootstrap_status AS status FROM installation_state WHERE singleton_key='PRIMARY'").get() as {status:string}|undefined;
      if(state?.status!=='PENDING'||db.prepare("SELECT 1 FROM devices WHERE status='ACTIVE' LIMIT 1").get()||db.prepare('SELECT 1 FROM users LIMIT 1').get())throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
    }
    if(enrollment?.pairingId){
      if(isDeviceRevokedByFloor(floor,payload.deviceId))throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
      const pairing=db.prepare("SELECT credential_hash FROM device_pairing_requests WHERE pairing_id=? AND device_id=? AND status='PENDING'")
        .get(enrollment.pairingId,payload.deviceId) as {credential_hash:string}|undefined;
      if(!pairing||pairing.credential_hash!==enrollment.credentialHash)throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
      if(db.prepare("UPDATE devices SET status='ACTIVE',activated_at=? WHERE id=? AND status='PENDING'").run(Date.now(),payload.deviceId).changes!==1)
        throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
      db.prepare("UPDATE device_pairing_requests SET status='ACTIVE',consumed_at=?,authorization_id=? WHERE pairing_id=?").run(Date.now(),enrollment.authorizationId,enrollment.pairingId);
      db.prepare('INSERT INTO device_credentials(credential_id,device_id,credential_hash,created_at) VALUES(?,?,?,?)')
        .run(enrollment.credentialId,payload.deviceId,enrollment.credentialHash,Date.now());
    }
    db.prepare(`INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at,version,trust_domain_id,credential_revision,authorization_revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,status=excluded.status,pin_hash=excluded.pin_hash,
      version=excluded.version,trust_domain_id=excluded.trust_domain_id,credential_revision=excluded.credential_revision,authorization_revision=excluded.authorization_revision`)
      .run(descriptor.userId,descriptor.tenantId,descriptor.locationId,payload.displayName,payload.status,payload.pinHash,Date.now(),payload.targetVersion,descriptor.trustDomainId,descriptor.target.credentialRevision,descriptor.target.authorizationRevision);
    db.prepare('DELETE FROM user_roles WHERE user_id=?').run(descriptor.userId);
    for(const role of payload.roles)db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES(?,?)').run(descriptor.userId,role);
    db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(Date.now(),descriptor.userId);
    const auditId=EntityId.generate().toString(),eventId=EntityId.generate().toString(),now=new Date();
    const publicAfter={userId:descriptor.userId,status:payload.status,roles:payload.roles,credentialRevision:descriptor.target.credentialRevision,
      authorizationRevision:descriptor.target.authorizationRevision,sessionRevision:descriptor.target.sessionRevision};
    db.prepare(`INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,version,payload,occurred_at,recovery_epoch,command_id,sync_status)
      VALUES(?,'PERSONNEL_CHANGED','USER',?,?,?,?,?,?,'PENDING')`).run(eventId,descriptor.userId,payload.targetVersion,JSON.stringify(publicAfter),now.getTime(),floor.recoveryEpoch,descriptor.commandId);
    insertAuditEntry(drizzle(db,{schema:edgeSchema}),{auditId,occurredAt:now,tenantId:descriptor.tenantId,locationId:descriptor.locationId,
      deviceId:payload.deviceId,sessionId:payload.sessionId,actorUserId:payload.actorUserId,actorRole:null,authorizedByUserId:null,authorizedByRole:null,
      ...(enrollment?{actorType:'CLOUD_ADMIN_AUTHORIZATION' as const,authorizationId:enrollment.authorizationId,source:payload.bootstrap?'CLOUD_INSTALLATION_AUTHORIZATION':'OWNER_RECOVERY'}:{}),
      action:'PERSONNEL_CHANGED',entityType:'USER',entityId:descriptor.userId,outcome:'SUCCESS',reason:payload.reason,commandId:descriptor.commandId,
      before:null,after:publicAfter,amountAffected:null,currency:null,eventId});
    if(payload.ownerRecovery){
      db.prepare('INSERT INTO owner_recovery_acknowledgements(authorization_id,transition_id,command_id,consumed_at) VALUES(?,?,?,?)')
        .run(payload.ownerRecovery.authorizationId,descriptor.transitionId,payload.ownerRecovery.ackCommandId,payload.ownerRecovery.consumedAt);
      if(payload.ownerRecovery.pairingId)insertAuditEntry(drizzle(db,{schema:edgeSchema}),{auditId:EntityId.generate().toString(),occurredAt:now,
        tenantId:descriptor.tenantId,locationId:descriptor.locationId,deviceId:payload.deviceId,sessionId:null,actorUserId:null,actorRole:null,
        actorType:'CLOUD_ADMIN_AUTHORIZATION',authorizationId:payload.ownerRecovery.authorizationId,source:'OWNER_RECOVERY',authorizedByUserId:null,authorizedByRole:null,
        action:'DEVICE_PAIRED',entityType:'DEVICE',entityId:payload.deviceId,outcome:'SUCCESS',reason:'Exact pairing authorized for contractual owner recovery.',
        commandId:descriptor.commandId,before:null,after:{pairingId:payload.ownerRecovery.pairingId},amountAffected:null,currency:null,eventId:null});
    }
    if(payload.bootstrap){
      db.prepare("UPDATE installation_state SET bootstrap_status='COMPLETED',completed_at=?,authorization_id=?,first_device_id=?,initial_owner_user_id=?,cloud_ack_command_id=? WHERE singleton_key='PRIMARY'")
        .run(Date.now(),payload.bootstrap.authorizationId,payload.deviceId,descriptor.userId,payload.bootstrap.ackCommandId);
      insertAuditEntry(drizzle(db,{schema:edgeSchema}),{auditId:EntityId.generate().toString(),occurredAt:now,tenantId:descriptor.tenantId,locationId:descriptor.locationId,
        deviceId:payload.deviceId,sessionId:null,actorUserId:null,actorRole:null,actorType:'CLOUD_ADMIN_AUTHORIZATION',authorizationId:payload.bootstrap.authorizationId,
        source:'CLOUD_INSTALLATION_AUTHORIZATION',authorizedByUserId:null,authorizedByRole:null,action:'FIRST_DEVICE_BOOTSTRAP_COMPLETED',entityType:'INSTALLATION',
        entityId:payload.bootstrap.authorizationId,outcome:'SUCCESS',reason:'Initial owner and exact device enrolled with durable personnel security.',commandId:descriptor.commandId,
        before:null,after:null,amountAffected:null,currency:null,eventId:null});
    }
    db.prepare(`INSERT INTO personnel_security_receipts(transition_id,transition_digest,user_id,trust_domain_id,recovery_epoch,credential_revision,authorization_revision,session_revision,audit_id,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(descriptor.transitionId,intent.digest,descriptor.userId,descriptor.trustDomainId,floor.recoveryEpoch,entry.credentialRevision,entry.authorizationRevision,entry.sessionRevision,auditId,now.getTime());
    db.prepare("UPDATE personnel_security_intents SET state='APPLIED' WHERE transition_id=?").run(descriptor.transitionId);
    db.prepare('INSERT INTO processed_commands(command_id,processed_at) VALUES(?,?)').run(descriptor.commandId,now.getTime());
    if(descriptor.supersededTransitionId)db.prepare("UPDATE personnel_security_intents SET state='SUPERSEDED' WHERE transition_id=?").run(descriptor.supersededTransitionId);
  }).immediate();
  const receipt=db.prepare('SELECT transition_digest AS digest,credential_revision AS c,authorization_revision AS a,session_revision AS s FROM personnel_security_receipts WHERE transition_id=?').get(intent.transitionId) as {digest:string;c:number;a:number;s:number}|undefined;
  const user=users(db).find(u=>u.userId===descriptor.userId);
  if(!receipt||receipt.digest!==intent.digest||receipt.c!==entry.credentialRevision||receipt.a!==entry.authorizationRevision||receipt.s!==entry.sessionRevision||
    !user||user.trustDomainId!==descriptor.trustDomainId||user.credentialRevision!==entry.credentialRevision||user.authorizationRevision!==entry.authorizationRevision||
    user.pinHash!==payload.pinHash||user.status!==payload.status||JSON.stringify(roles(db,user.userId).map(r=>r.id))!==JSON.stringify(payload.roles))
    throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
  const completed=updateRecoverySecurityFloor(floor,{personnel:{...floor.personnel!,users:{...floor.personnel!.users,[descriptor.userId]:{...entry,pending:null}}}});
  await persist(completed);return completed;
}

export function trustedOwner(db:Database.Database,floor:RecoverySecurityFloor):boolean{
  return Boolean(floor.personnel&&users(db).some(user=>personnelRestrictions(floor.personnel!,user).length===0&&roles(db,user.userId).some(role=>role.name==='OWNER')));
}
function proveDevice(db:Database.Database,floor:RecoverySecurityFloor,input:{deviceId:string;deviceCredential:string;pairingId:string|null;requestToken?:string}){
  const device=db.prepare('SELECT status,device_type AS type FROM devices WHERE id=? AND tenant_id=? AND location_id=?')
    .get(input.deviceId,floor.binding!.tenantId,floor.binding!.locationId) as {status:string;type:'POS'|'WAITER'|'KDS'}|undefined;
  if(!device||isDeviceRevokedByFloor(floor,input.deviceId))throw new Error('DEVICE_NOT_AUTHORIZED');
  if(input.pairingId){
    const pairing=db.prepare("SELECT credential_hash AS hash,request_token_hash AS tokenHash FROM device_pairing_requests WHERE pairing_id=? AND device_id=? AND status='PENDING' AND expires_at>?")
      .get(input.pairingId,input.deviceId,Date.now()) as {hash:string;tokenHash:string}|undefined;
    if(device.status!=='PENDING'||!pairing||!input.requestToken||pairing.tokenHash!==createHash('sha256').update(input.requestToken).digest('hex')||
      !verifyDeviceCredential(input.deviceCredential,pairing.hash))throw new Error('DEVICE_NOT_AUTHORIZED');
    return {...device,hash:pairing.hash};
  }
  const credential=db.prepare('SELECT credential_hash AS hash FROM device_credentials WHERE device_id=? AND revoked_at IS NULL').get(input.deviceId) as {hash:string}|undefined;
  if(device.status!=='ACTIVE'||!credential||!verifyDeviceCredential(input.deviceCredential,credential.hash))throw new Error('DEVICE_NOT_AUTHORIZED');
  return {...device,hash:credential.hash};
}
async function recoverOwner(db:Database.Database,current:RecoverySecurityFloor,input:Extract<PersonnelSecurityOperation,{kind:'RECOVER_OWNER'}>,persist:Persist){
  const request=CompleteOwnerRecoveryRequestSchema.parse(input.request),p=verifyOwnerRecoveryAuthorization(request.authorization,input.publicKeyring).payload;
  const floor=current.personnel!,context=floor.recoveryContext,access=floor.ownerRecoveryAccess;
  if(!context||p.tenantId!==current.binding!.tenantId||p.locationId!==current.binding!.locationId||p.targetEdgeId!==current.binding!.edgeId||
    p.sourceEdgeId!==context.sourceEdgeId||p.recoveryId!==context.recoveryId||p.backupId!==context.backupId||p.recoveryEpoch!==current.recoveryEpoch||
    p.restoreAuthorizationId!==context.restoreAuthorizationId||p.trustDomainId!==floor.trustDomainId)throw new Error('OWNER_RECOVERY_BINDING_INVALID');
  const prior=db.prepare('SELECT transition_id AS transitionId FROM personnel_security_intents WHERE command_id=?').get(request.commandId) as {transitionId:string}|undefined;
  if(prior){
    const intent=readIntent(db,prior.transitionId)!,descriptor=PersonnelTransitionDescriptorSchema.parse(JSON.parse(intent.descriptor)),payload=privatePayloadSchema.parse(JSON.parse(intent.payload));
    if(descriptor.userId!==p.ownerUserId||descriptor.authority.kind!=='OWNER_RECOVERY'||descriptor.authority.authorizationId!==p.authorizationId||
      payload.ownerRecovery?.authorizationId!==p.authorizationId||payload.deviceId!==p.deviceId||!await verifyOperationalPin(request.newPin,payload.pinHash))throw new Error('COMMAND_ID_CONFLICT');
    if(floor.users[p.ownerUserId]?.pending?.transitionId===intent.transitionId)await resume(db,current,intent,persist);
    else if(intent.state!=='APPLIED')throw new Error('USER_SECURITY_REPAIR_REQUIRED');
    return;
  }
  if(trustedOwner(db,current)||access.generation!==p.accessGeneration||access.challenge?.challengeId!==p.challengeId||
    access.challenge.deviceId!==p.deviceId||access.challenge.pairingId!==p.pairingId)throw new Error('OWNER_RECOVERY_AUTHORIZATION_CONSUMED');
  if(Date.parse(p.issuedAt)>Date.now()||Date.parse(p.expiresAt)<=Date.now())throw new Error('OWNER_RECOVERY_AUTHORIZATION_EXPIRED');
  if(db.inTransaction)throw new Error('PERSONNEL_TRANSACTION_ALREADY_OPEN');db.exec('BEGIN IMMEDIATE');
  try{
    const device=proveDevice(db,current,{deviceId:p.deviceId,deviceCredential:request.deviceCredential,pairingId:p.pairingId,...(request.requestToken?{requestToken:request.requestToken}:{})});
    if(p.pairingId){
      const count=(db.prepare("SELECT count(*) AS n FROM devices WHERE tenant_id=? AND location_id=? AND device_type=? AND status='ACTIVE'")
        .get(current.binding!.tenantId,current.binding!.locationId,device.type) as {n:number}).n;
      input.licensing.assertDevicePairingAllowed(device.type,count);
    }
    if(db.prepare('SELECT 1 FROM processed_commands WHERE command_id=?').get(request.commandId))throw new Error('COMMAND_ID_CONFLICT');
    for(const user of users(db))if(await verifyOperationalPin(request.newPin,user.pinHash))throw new Error('PERSONNEL_NEW_PIN_REQUIRED');
    const existing=users(db).find(user=>user.userId===p.ownerUserId),previous=floor.users[p.ownerUserId];
    const from={credentialRevision:previous?.credentialRevision??0,authorizationRevision:previous?.authorizationRevision??0,sessionRevision:previous?.sessionRevision??0};
    const target=nextPersonnelRevisions(from,'RECOVER_OWNER'),role=db.prepare("SELECT id FROM roles WHERE name='OWNER'").get() as {id:string}|undefined;
    if(!role)throw new Error('PERSONNEL_ROLE_ASSIGNMENT_INVALID');
    const descriptor:PersonnelTransitionDescriptor={formatVersion:1,tenantId:p.tenantId,locationId:p.locationId,edgeId:p.targetEdgeId,trustDomainId:p.trustDomainId,
      userId:p.ownerUserId,transitionId:EntityId.generate().toString(),commandId:request.commandId,kind:'RECOVER_OWNER',authority:{kind:'OWNER_RECOVERY',authorizationId:p.authorizationId},
      authorizedDeviceId:p.deviceId,authorizedPairingId:p.pairingId,
      from,target,targetStatus:'ACTIVE',targetRoleIds:[role.id],supersededTransitionId:previous?.pending?.transitionId??null};
    const digest=personnelTransitionDigest(descriptor),payload:PrivatePayload={displayName:existing?.displayName??'OWNER',pinHash:await hashOperationalPin(request.newPin),roles:[role.id],status:'ACTIVE',
      actorUserId:p.ownerUserId,deviceId:p.deviceId,sessionId:null,reason:'Contractual owner recovery authorized by Cloud.',targetVersion:(existing?.version??0)+1,
      ownerRecovery:{authorizationId:p.authorizationId,pairingId:p.pairingId,credentialId:EntityId.generate().toString(),credentialHash:device.hash,consumedAt:Date.now(),ackCommandId:EntityId.generate().toString()}};
    privatePayloadSchema.parse(payload);
    if(Date.parse(p.expiresAt)<=Date.now())throw new Error('OWNER_RECOVERY_AUTHORIZATION_EXPIRED');
    current=updateRecoverySecurityFloor(current,{personnel:{...floor,users:{...floor.users,[p.ownerUserId]:{...target,pending:{transitionId:descriptor.transitionId,commandId:request.commandId,
      kind:'RECOVER_OWNER',authority:descriptor.authority,transitionDigest:digest}}},ownerRecoveryAccess:{generation:access.generation+1,challenge:null,pendingConsumption:{authorizationId:p.authorizationId,transitionId:descriptor.transitionId}}}});
    await persist(current);
    db.prepare(`INSERT INTO personnel_security_intents(transition_id,command_id,user_id,trust_domain_id,recovery_epoch,transition_digest,descriptor_json,private_payload_json,state,created_at)
      VALUES(?,?,?,?,?,?,?,?,'PREPARED',?)`).run(descriptor.transitionId,request.commandId,p.ownerUserId,p.trustDomainId,current.recoveryEpoch,digest,JSON.stringify(descriptor),JSON.stringify(payload),Date.now());
    db.exec('COMMIT');await resume(db,current,readIntent(db,descriptor.transitionId)!,persist);
  }finally{if(db.inTransaction)db.exec('ROLLBACK');}
}

async function bootstrapOwner(db:Database.Database,current:RecoverySecurityFloor,input:Extract<PersonnelSecurityOperation,{kind:'BOOTSTRAP_OWNER'}>,persist:Persist){
  const request=CompleteBootstrapRequestSchema.parse(input.request),p=verifyInstallationAuthorization(request.authorization,input.publicKeyring).payload;
  if(p.tenantId!==current.binding!.tenantId||p.locationId!==current.binding!.locationId||p.edgeId!==current.binding!.edgeId||p.pairingId!==request.pairingId||
    current.personnel!.recoveryContext)throw new Error('INSTALLATION_AUTHORIZATION_INVALID');
  const pairing=db.prepare(`SELECT p.device_id AS deviceId,p.code_hash AS codeHash,p.request_token_hash AS requestTokenHash,p.credential_hash AS credentialHash,
    p.expires_at AS expiresAt,p.status,d.device_type AS deviceType,d.name FROM device_pairing_requests p JOIN devices d ON d.id=p.device_id
    WHERE p.pairing_id=? AND p.edge_id=? AND p.tenant_id=? AND p.location_id=?`).get(request.pairingId,p.edgeId,p.tenantId,p.locationId) as
    {deviceId:string;codeHash:string;requestTokenHash:string;credentialHash:string;expiresAt:number;status:string;deviceType:'POS'|'WAITER'|'KDS';name:string}|undefined;
  if(!pairing||pairing.deviceId!==p.deviceId||pairing.deviceType!==p.deviceType||pairing.name!==p.displayName||pairing.codeHash!==p.pairingCodeHash||
    pairing.codeHash!==hashPairingCode(p.pairingId,request.pairingCode)||pairing.requestTokenHash!==createHash('sha256').update(request.requestToken).digest('hex')||
    isDeviceRevokedByFloor(current,p.deviceId))throw new Error('INSTALLATION_AUTHORIZATION_INVALID');
  const prior=db.prepare('SELECT transition_id AS id FROM personnel_security_intents WHERE command_id=?').get(p.authorizationId) as {id:string}|undefined;
  if(prior){const intent=readIntent(db,prior.id)!,payload=privatePayloadSchema.parse(JSON.parse(intent.payload));
    if(payload.bootstrap?.authorizationId!==p.authorizationId||!await verifyOperationalPin(request.ownerPin,payload.pinHash))throw new Error('COMMAND_ID_CONFLICT');
    if(current.personnel!.users[p.initialOwnerId]?.pending?.transitionId===intent.transitionId)await resume(db,current,intent,persist);
    else if(intent.state!=='APPLIED')throw new Error('USER_SECURITY_REPAIR_REQUIRED');return;
  }
  if(Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.issuedAt)>Date.now()||pairing.expiresAt<=Date.now())throw new Error('INSTALLATION_AUTHORIZATION_EXPIRED');
  if(db.inTransaction)throw new Error('PERSONNEL_TRANSACTION_ALREADY_OPEN');db.exec('BEGIN IMMEDIATE');
  try{
    const state=db.prepare("SELECT bootstrap_status AS status FROM installation_state WHERE singleton_key='PRIMARY'").get() as {status:string}|undefined;
    if(state?.status!=='PENDING'||users(db).length||db.prepare("SELECT 1 FROM devices WHERE status='ACTIVE' LIMIT 1").get())throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
    input.licensing.assertDevicePairingAllowed(pairing.deviceType,0);
    const floor=current.personnel!,previous=floor.users[p.initialOwnerId];
    if(previous?.pending?.commandId===p.authorizationId)throw new Error('USER_SECURITY_REPAIR_REQUIRED');
    if(Object.keys(floor.users).some(userId=>userId!==p.initialOwnerId)||db.prepare('SELECT 1 FROM processed_commands WHERE command_id=?').get(p.authorizationId))throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
    // Only the first signed bootstrap may materialize canonical grants. Never run
    // this on startup, restore, recovery, or an already enrolled installation.
    const history=db.prepare("SELECT 1 FROM installation_state WHERE completed_at IS NOT NULL OR authorization_id IS NOT NULL OR initial_owner_user_id IS NOT NULL OR first_device_id IS NOT NULL").get();
    if(history||current.recoveryEpoch!==0||Object.keys(floor.users).length||
      db.prepare('SELECT 1 FROM personnel_security_intents LIMIT 1').get())throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
    for(const [name,grants] of Object.entries(BASE_ROLE_PERMISSIONS)){
      db.prepare('INSERT OR IGNORE INTO roles(id,name) VALUES(?,?)').run(EntityId.generate().toString(),name);
      const baseRole=db.prepare('SELECT id FROM roles WHERE name=?').get(name) as {id:string};
      for(const permission of grants){
        db.prepare('INSERT OR IGNORE INTO permissions(code,description) VALUES(?,?)').run(permission,permission);
        db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(baseRole.id,permission);
      }
    }
    const from={credentialRevision:previous?.credentialRevision??0,authorizationRevision:previous?.authorizationRevision??0,sessionRevision:previous?.sessionRevision??0},
      target=nextPersonnelRevisions(from,'ENROLL'),role=db.prepare("SELECT id FROM roles WHERE name='OWNER'").get() as {id:string}|undefined;
    if(!role)throw new Error('PERSONNEL_ROLE_ASSIGNMENT_INVALID');
    const descriptor:PersonnelTransitionDescriptor={formatVersion:1,tenantId:p.tenantId,locationId:p.locationId,edgeId:p.edgeId,trustDomainId:floor.trustDomainId,
      userId:p.initialOwnerId,transitionId:EntityId.generate().toString(),commandId:p.authorizationId,kind:'ENROLL',authority:{kind:'INSTALLATION_AUTHORIZATION',authorizationId:p.authorizationId},
      authorizedDeviceId:p.deviceId,authorizedPairingId:p.pairingId,from,target,targetStatus:'ACTIVE',targetRoleIds:[role.id],supersededTransitionId:previous?.pending?.transitionId??null};
    const digest=personnelTransitionDigest(descriptor),payload:PrivatePayload={displayName:p.initialOwnerDisplayName,pinHash:await hashOperationalPin(request.ownerPin),roles:[role.id],status:'ACTIVE',
      actorUserId:p.initialOwnerId,deviceId:p.deviceId,sessionId:null,reason:'Initial contractual owner authorized by Cloud.',targetVersion:1,
      bootstrap:{authorizationId:p.authorizationId,pairingId:p.pairingId,credentialId:EntityId.generate().toString(),credentialHash:pairing.credentialHash,ackCommandId:EntityId.generate().toString()}};
    privatePayloadSchema.parse(payload);
    if(Date.parse(p.expiresAt)<=Date.now()||pairing.expiresAt<=Date.now())throw new Error('INSTALLATION_AUTHORIZATION_EXPIRED');
    current=updateRecoverySecurityFloor(current,{personnel:{...floor,users:{...floor.users,[p.initialOwnerId]:{...target,pending:{transitionId:descriptor.transitionId,commandId:p.authorizationId,
      kind:'ENROLL',authority:descriptor.authority,transitionDigest:digest}}}}});await persist(current);
    db.prepare(`INSERT INTO personnel_security_intents(transition_id,command_id,user_id,trust_domain_id,recovery_epoch,transition_digest,descriptor_json,private_payload_json,state,created_at)
      VALUES(?,?,?,?,?,?,?,?,'PREPARED',?)`).run(descriptor.transitionId,p.authorizationId,p.initialOwnerId,floor.trustDomainId,current.recoveryEpoch,digest,JSON.stringify(descriptor),JSON.stringify(payload),Date.now());
    db.exec('COMMIT');await resume(db,current,readIntent(db,descriptor.transitionId)!,persist);
  }finally{if(db.inTransaction)db.exec('ROLLBACK');}
}

async function baseline(db:Database.Database,floor:RecoverySecurityFloor,persist:Persist){
  const journal=floor.administrationUpgradeJournal;
  if(!journal||journal.phase!=='SNAPSHOT_READY'||journal.migrationHash!==administrationMigrationDigest()||!floor.recoveryKey||
    resolve(journal.databasePath)!==resolve(db.name)||
    floor.personnel?.initializationState==='ACTIVE'||inspectAdministrationSchema(db)!==15)throw new Error('PERSONNEL_BASELINE_NOT_AUTHORIZED');
  const artifact=await verifyEncryptedBackupArtifact({artifactPath:journal.snapshotPath,recoveryKey:floor.recoveryKey,
    expectedBackupId:journal.snapshotId,expectedBinding:{...floor.binding!,recoveryEpoch:floor.recoveryEpoch}});
  try{
    if(db.inTransaction)throw new Error('PERSONNEL_TRANSACTION_ALREADY_OPEN');
    db.exec('BEGIN IMMEDIATE');
    const before=new Database(artifact.stagedDatabasePath,{readonly:true,fileMustExist:true});
    try{
      if(inspectAdministrationSchema(before)!==14)throw new Error('PERSONNEL_BASELINE_NOT_AUTHORIZED');
      binding(before,floor);
      if(JSON.stringify(revisionedRows(before))!==JSON.stringify(revisionedRows(db))||
        JSON.stringify(before.prepare('SELECT user_id,role_id FROM user_roles ORDER BY user_id,role_id').all())!==JSON.stringify(db.prepare('SELECT user_id,role_id FROM user_roles ORDER BY user_id,role_id').all()))
        throw new Error('PERSONNEL_BASELINE_CHANGED');
      const ids=(before.prepare('SELECT id FROM users ORDER BY id').all() as Array<{id:string}>).map(r=>r.id);
      const personnel:PersonnelSecurityFloor=floor.personnel??{formatVersion:1,trustDomainId:EntityId.generate().toString(),initializationState:'INITIALIZING',
        users:Object.fromEntries(ids.map(id=>[id,{credentialRevision:1,authorizationRevision:1,sessionRevision:1,pending:null}])),
        ownerRecoveryAccess:{generation:0,challenge:null,pendingConsumption:null}};
      PersonnelSecurityFloorSchema.parse(personnel);
      if(baselineDigest(Object.keys(personnel.users))!==baselineDigest(ids))throw new Error('PERSONNEL_BASELINE_CHANGED');
      floor=updateRecoverySecurityFloor(floor,{personnel,minimumSchemaVersion:15});await persist(floor);
      db.transaction(()=>{
        db.prepare('UPDATE users SET trust_domain_id=?,credential_revision=1,authorization_revision=1').run(personnel.trustDomainId);
        db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE revoked_at IS NULL').run(Date.now());
        db.prepare('INSERT OR IGNORE INTO personnel_baseline_receipts(trust_domain_id,recovery_epoch,users_digest,completed_at) VALUES(?,?,?,?)')
          .run(personnel.trustDomainId,floor.recoveryEpoch,baselineDigest(ids),Date.now());
      }).immediate();
      db.exec('COMMIT');
      const receipt=db.prepare('SELECT recovery_epoch AS epoch,users_digest AS digest FROM personnel_baseline_receipts WHERE trust_domain_id=?').get(personnel.trustDomainId) as {epoch:number;digest:string}|undefined;
      if(!receipt||receipt.epoch!==floor.recoveryEpoch||receipt.digest!==baselineDigest(ids))throw new Error('PERSONNEL_BASELINE_INVALID');
      if(users(db).some(u=>u.trustDomainId!==personnel.trustDomainId||u.credentialRevision!==1||u.authorizationRevision!==1))throw new Error('PERSONNEL_BASELINE_INVALID');
      await persist(updateRecoverySecurityFloor(floor,{personnel:{...personnel,initializationState:'ACTIVE'}}));
    }finally{before.close();}
  }finally{if(db.inTransaction)db.exec('ROLLBACK');await artifact.cleanup();}
}
