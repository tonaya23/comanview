import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { EntityId } from '@comanview/domain';
import { hashDeviceCredential, hashOperationalPinSync, verifyDeviceCredential } from '@comanview/auth';
import type { DeviceRepository } from '@comanview/database';
import type { DeviceType, InstallationAuthorizationEnvelope } from '@comanview/contracts';
import { hashPairingCode, verifyInstallationAuthorization } from '@comanview/licensing';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { AppError } from '../../app/errorHandler.js';
import type { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';

const TTL=10*60_000, MAX_ATTEMPTS=5;
const hash=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
type DeviceBootstrapLog={warn(context:Record<string,unknown>,message:string):void};
const SILENT_LOG:DeviceBootstrapLog={warn:()=>undefined};
export class DeviceService {
  constructor(private readonly repository:DeviceRepository,
    private readonly licensing:EdgeLicenseManager, private readonly context:{edgeId:string;tenantId:string;locationId:string},
    private readonly publicKeyring:Readonly<Record<string,string>>,private readonly log:DeviceBootstrapLog=SILENT_LOG) {}
  createPairing(input:{deviceId:string;deviceType:DeviceType;displayName:string;credential:string},now=new Date()) {
    const registered=this.repository.registeredIdentity(input.deviceId,this.context.tenantId,this.context.locationId);
    if(registered?.device.status==='REVOKED'&&registered.credentialHashes.some((encoded)=>verifyDeviceCredential(input.credential,encoded))) {
      throw new AppError('DEVICE_REPAIR_REQUIRED',409,
        'The revoked Device identity must be replaced before requesting a new pairing.');
    }
    const pairingId=EntityId.generate().toString(), requestToken=randomBytes(32).toString('base64url');
    const code=randomInt(0,1_000_000).toString().padStart(6,'0');
    try { this.repository.createPairing({...input,pairingId,edgeId:this.context.edgeId,tenantId:this.context.tenantId,
      locationId:this.context.locationId,codeHash:hashPairingCode(pairingId,code),requestTokenHash:hash(requestToken),
      credentialHash:hashDeviceCredential(input.credential),now,expiresAt:new Date(now.getTime()+TTL),
      sessionTimeoutMinutes:input.deviceType==='KDS'?1440:720,
      audit:this.auditEntry('DEVICE_PAIRING_CREATED','PAIRING',pairingId,'SYSTEM','Solicitud de pairing creada por el dispositivo.',now,null)}); }
    catch(error){this.mapStateError(error);}
    return {pairingId,requestToken,pairingCode:code,device:this.device(this.repository.getPairing(pairingId)!.device),expiresAt:new Date(now.getTime()+TTL).toISOString()};
  }
  status(pairingId:string,requestToken:string,now=new Date()) {
    const row=this.repository.getPairingByRequestTokenHash(hash(requestToken));
    if(!row||row.pairing.pairingId!==pairingId) throw new AppError('DEVICE_NOT_AUTHORIZED',401,'Pairing request proof is invalid.');
    return this.pairing(row,now);
  }
  listDevices(){return {data:this.repository.list(this.context.tenantId,this.context.locationId).map((d)=>this.device(d))};}
  listPairings(now=new Date()){return {data:this.repository.listPairings(this.context.tenantId,this.context.locationId).map((r)=>this.pairing(r,now))};}
  approve(pairingId:string,code:string,commandId:string,actor:AuthenticatedActor,now=new Date()) {
    const previous=this.repository.auditEntityForCommand(commandId,'DEVICE_PAIRED');
    if(previous){const existing=this.repository.getPairing(pairingId);if(existing&&previous===existing.device.id)return this.device(existing.device);}
    const row=this.requirePending(pairingId,now); this.verifyCode(row.pairing,code,now);
    try { this.licensing.assertDevicePairingAllowed(row.device.deviceType as DeviceType,this.repository.activeCount(this.context.tenantId,this.context.locationId,row.device.deviceType)); }
    catch(error){this.repository.appendAudit(this.auditEntry('DEVICE_LIMIT_EXCEEDED_ATTEMPT','DEVICE',row.device.id,'USER','Pairing rechazado por límites o capabilities.',now,actor,undefined,commandId,'REJECTED'));throw error;}
    this.repository.approve({pairingId,credentialId:EntityId.generate().toString(),approvedByUserId:actor.userId,now,
      audit:this.auditEntry('DEVICE_PAIRED','DEVICE',row.device.id,'USER','Pairing aprobado localmente.',now,actor,undefined,commandId)});
    return this.device(this.repository.getPairing(pairingId)!.device);
  }
  completeBootstrap(input:{pairingId:string;pairingCode:string;requestToken:string;authorization:InstallationAuthorizationEnvelope;ownerPin:string},now=new Date()) {
    const row=this.repository.getPairing(input.pairingId);
    if(!row) throw new AppError('DEVICE_NOT_PAIRED',404,'Pairing not found.');
    if(!safeEqual(row.pairing.requestTokenHash,hash(input.requestToken))) throw new AppError('INSTALLATION_AUTHORIZATION_INVALID',401,'Bootstrap proof is invalid.');
    let payload; try { payload=verifyInstallationAuthorization(input.authorization,this.publicKeyring).payload; }
    catch { throw new AppError('INSTALLATION_AUTHORIZATION_INVALID',401,'Installation authorization is invalid.'); }
    const mismatchedFields:string[]=[];
    if(payload.tenantId!==this.context.tenantId)mismatchedFields.push('tenantId');
    if(payload.locationId!==this.context.locationId)mismatchedFields.push('locationId');
    if(payload.edgeId!==this.context.edgeId)mismatchedFields.push('edgeId');
    if(payload.pairingId!==input.pairingId)mismatchedFields.push('pairingId');
    if(payload.deviceId!==row.device.id)mismatchedFields.push('deviceId');
    if(payload.deviceType!==row.device.deviceType)mismatchedFields.push('deviceType');
    if(payload.displayName!==row.device.name)mismatchedFields.push('displayName');
    if(payload.pairingCodeHash!==row.pairing.codeHash)mismatchedFields.push('pairingCodeIdentity');
    if(mismatchedFields.length){
      this.log.warn({component:'device-bootstrap',stage:'BINDING_VALIDATION',
        code:'INSTALLATION_AUTHORIZATION_BINDING_INVALID',mismatchedFields},
      'Installation authorization binding validation failed');
      throw new AppError('INSTALLATION_AUTHORIZATION_INVALID',401,'Installation authorization binding is invalid.');
    }
    const installation=this.repository.installation();
    if(installation?.bootstrapStatus==='COMPLETED'&&installation.authorizationId===payload.authorizationId&&row.pairing.status==='ACTIVE'&&row.pairing.authorizationId===payload.authorizationId)return this.device(row.device);
    if(Date.parse(payload.expiresAt)<=now.getTime()) throw new AppError('INSTALLATION_AUTHORIZATION_INVALID',401,'Installation authorization is expired.');
    this.requirePending(input.pairingId,now);this.verifyCode(row.pairing,input.pairingCode,now);
    this.licensing.assertDevicePairingAllowed(row.device.deviceType as DeviceType,this.repository.activeCount(this.context.tenantId,this.context.locationId,row.device.deviceType));
    try { this.repository.completeBootstrap({pairingId:input.pairingId,credentialId:EntityId.generate().toString(),authorizationId:payload.authorizationId,
      cloudAckCommandId:EntityId.generate().toString(),
      owner:{id:payload.initialOwnerId,displayName:payload.initialOwnerDisplayName,pinHash:hashOperationalPinSync(input.ownerPin)},
      now,
      audit:this.auditEntry('FIRST_DEVICE_BOOTSTRAP_COMPLETED','INSTALLATION',payload.authorizationId,'CLOUD_ADMIN_AUTHORIZATION','Bootstrap inicial autorizado por Cloud.',now,null,payload.authorizationId)}); }
    catch(error){this.mapStateError(error);}
    return this.device(this.repository.getPairing(input.pairingId)!.device);
  }
  revoke(deviceId:string,reason:string,commandId:string,actor:AuthenticatedActor,now=new Date()) {
    if(this.repository.auditEntityForCommand(commandId,'DEVICE_REVOKED')===deviceId)return {revoked:true as const};
    try { this.repository.revoke({deviceId,tenantId:this.context.tenantId,locationId:this.context.locationId,now,
      audit:this.auditEntry('DEVICE_REVOKED','DEVICE',deviceId,'USER',reason,now,actor,undefined,commandId)}); }
    catch(error){this.mapStateError(error);} return {revoked:true as const};
  }
  cancel(pairingId:string,commandId:string,actor:AuthenticatedActor,now=new Date()){
    if(this.repository.auditEntityForCommand(commandId,'DEVICE_PAIRING_CANCELLED')===pairingId)return {cancelled:true as const};
    if(!this.repository.cancel({pairingId,now,audit:this.auditEntry('DEVICE_PAIRING_CANCELLED','PAIRING',pairingId,'USER','Pairing cancelado localmente.',now,actor,undefined,commandId)})) throw new AppError('PAIRING_ALREADY_CONSUMED',409,'Pairing is no longer pending.');return {cancelled:true as const};}
  readiness(){const s=this.repository.readinessSnapshot(this.context.tenantId,this.context.locationId);const effective=this.licensing.effectiveCapabilities();
    const c=(key:string,ready:boolean,code:string,detail:string)=>({key,state:ready?'READY' as const:'NOT_READY' as const,code,detail});
    const components=[c('EDGE',true,'EDGE_UP','Edge service operativo.'),c('DATABASE',true,'DATABASE_OK','SQLite accesible.'),c('TENANT_LOCATION',Boolean(this.context.tenantId&&this.context.locationId),'BOUND','Binding persistido.'),
      {key:'LICENSE',state:['NO_VALID_LICENSE','POST_GRACE_BLOCKED','SUSPENDED_BLOCKED','TERMINATED_BLOCKED'].includes(effective.mode)?'NOT_READY' as const:effective.cloudReachable?'READY' as const:'DEGRADED' as const,code:effective.reasonCode,detail:`Modo ${effective.mode}.`},
      c('CATALOG',s.productCount>0,'CATALOG_EMPTY',`${s.productCount} productos activos.`),c('USERS',s.activeUsers>0,'USERS_EMPTY',`${s.activeUsers} usuarios activos.`),c('RBAC',s.roleCount>=5&&s.devicePermissionAssignments>=8,'RBAC_INCOMPLETE',`${s.roleCount} roles; ${s.devicePermissionAssignments} asignaciones Device.`),
      c('CASH_REGISTER',s.cashRegisters>0,'CASH_REGISTER_MISSING',`${s.cashRegisters} cajas.`),c('STATIONS',s.stations>0||!effective.capabilities.includes('KDS'),'STATIONS_MISSING',`${s.stations} estaciones.`),
      c('PRINTING',s.printTargets>0||!effective.capabilities.includes('PRINTING'),'PRINT_TARGET_MISSING',`${s.printTargets} destinos.`),c('DEVICES',s.activeDevices>0,'DEVICE_MISSING',`${s.activeDevices} dispositivos activos.`),
      c('BOOTSTRAP',s.installation?.bootstrapStatus==='COMPLETED','BOOTSTRAP_PENDING',s.installation?.bootstrapStatus??'PENDING'),
      {key:'SYNC',state:s.sync?.lastSuccessfulSyncAt?'READY' as const:'DEGRADED' as const,code:s.sync?.lastSuccessfulSyncAt?'SYNC_VERIFIED':'SYNC_NOT_VERIFIED',detail:'Sync no bloquea operación local.'},
      {key:'BACKUP',state:'PENDING_PHASE' as const,code:'PENDING_1V',detail:'Backup/Recovery se implementará en Fase 1V.'}];
    return {technicalHealth:'READY' as const,operationalReadiness:components.filter(x=>!['SYNC','BACKUP'].includes(x.key)).every(x=>x.state==='READY')?'READY' as const:'NOT_READY' as const,productionReadiness:'NOT_READY' as const,licensingStatus:effective.mode,components}; }
  private requirePending(id:string,now:Date){const row=this.repository.getPairing(id);if(!row)throw new AppError('DEVICE_NOT_PAIRED',404,'Pairing not found.');if(row.pairing.expiresAt<=now)throw new AppError('PAIRING_EXPIRED',409,'Pairing expired.');if(row.pairing.status!=='PENDING')throw new AppError('PAIRING_ALREADY_CONSUMED',409,'Pairing is no longer pending.');if(row.pairing.lockedUntil&&row.pairing.lockedUntil>now)throw new AppError('PAIRING_RATE_LIMITED',429,'Pairing is temporarily locked.');return row;}
  private verifyCode(pairing:{pairingId:string;codeHash:string},code:string,now:Date){if(!safeEqual(pairing.codeHash,hashPairingCode(pairing.pairingId,code))){const attempts=this.repository.recordFailedAttempt(pairing.pairingId,now,MAX_ATTEMPTS);if(attempts>=MAX_ATTEMPTS)this.repository.appendAudit(this.auditEntry('DEVICE_PAIRING_RATE_LIMITED','PAIRING',pairing.pairingId,'SYSTEM','Pairing bloqueado temporalmente tras intentos inválidos.',now,null,undefined,null,'REJECTED'));throw new AppError(attempts>=MAX_ATTEMPTS?'PAIRING_RATE_LIMITED':'PAIRING_CODE_INVALID',attempts>=MAX_ATTEMPTS?429:401,'Pairing code is invalid.');}}
  private pairing(row:{pairing:any;device:any},now:Date){return {pairingId:row.pairing.pairingId,status:row.pairing.expiresAt<=now&&row.pairing.status==='PENDING'?'EXPIRED':row.pairing.status,device:this.device(row.device),expiresAt:row.pairing.expiresAt.toISOString()};}
  private device(d:any){return {deviceId:d.id,displayName:d.name,type:d.deviceType,status:d.status,createdAt:d.createdAt.toISOString(),activatedAt:d.activatedAt?.toISOString()??null,revokedAt:d.revokedAt?.toISOString()??null};}
  private auditEntry(action:any,entityType:any,entityId:string,actorType:any,reason:string,now:Date,actor:AuthenticatedActor|null,authorizationId?:string,commandId:string|null=null,outcome:'SUCCESS'|'REJECTED'='SUCCESS'){return {auditId:EntityId.generate().toString(),occurredAt:now,tenantId:this.context.tenantId,locationId:this.context.locationId,deviceId:actor?.deviceId??null,sessionId:actor?.sessionId??null,actorUserId:actor?.userId??null,actorRole:actor?.roles[0]??null,actorType,authorizationId:authorizationId??null,source:actorType==='USER'?null:actorType==='SYSTEM'?'DEVICE_PAIRING_FLOW':'CLOUD_INSTALLATION_AUTHORIZATION',authorizedByUserId:null,authorizedByRole:null,action,entityType,entityId,outcome,reason,commandId,before:null,after:null,amountAffected:null,currency:null,eventId:null};}
  private mapStateError(error:unknown):never{const code=error instanceof Error?error.message:'INTERNAL_ERROR';if(['PAIRING_ALREADY_CONSUMED','INSTALLATION_BOOTSTRAP_CLOSED','DEVICE_NOT_AUTHORIZED','DEVICE_ALREADY_REGISTERED'].includes(code))throw new AppError(code,409,code);throw error;}
}
