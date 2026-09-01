import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
import { insertAuditEntry, type NewAuditEntry } from './AuditRepository.js';

type DB = BetterSQLite3Database<typeof schema>;
export class DeviceRepository {
  constructor(private readonly db: DB) {}
  list(tenantId: string, locationId: string) {
    return this.db.select().from(schema.devices).where(and(eq(schema.devices.tenantId,tenantId),eq(schema.devices.locationId,locationId))).all();
  }
  listPairings(tenantId: string, locationId: string) {
    return this.db.select({ pairing: schema.devicePairingRequests, device: schema.devices }).from(schema.devicePairingRequests)
      .innerJoin(schema.devices,eq(schema.devices.id,schema.devicePairingRequests.deviceId))
      .where(and(eq(schema.devicePairingRequests.tenantId,tenantId),eq(schema.devicePairingRequests.locationId,locationId)))
      .orderBy(desc(schema.devicePairingRequests.createdAt)).limit(50).all();
  }
  registeredIdentity(deviceId:string,tenantId:string,locationId:string) {
    const device=this.db.select().from(schema.devices).where(and(eq(schema.devices.id,deviceId),
      eq(schema.devices.tenantId,tenantId),eq(schema.devices.locationId,locationId))).get();
    if(!device)return null;
    const credentialHashes=this.db.select({credentialHash:schema.deviceCredentials.credentialHash})
      .from(schema.deviceCredentials).where(eq(schema.deviceCredentials.deviceId,deviceId)).all()
      .map((row)=>row.credentialHash);
    return {device,credentialHashes};
  }
  createPairing(input: { pairingId:string; deviceId:string; edgeId:string; tenantId:string; locationId:string;
    deviceType:string; displayName:string; codeHash:string; requestTokenHash:string; credentialHash:string;
    now:Date; expiresAt:Date; sessionTimeoutMinutes:number; audit:NewAuditEntry }) {
    this.db.transaction((tx) => {
      tx.update(schema.devicePairingRequests).set({status:'EXPIRED',consumedAt:input.now})
        .where(and(eq(schema.devicePairingRequests.deviceId,input.deviceId),eq(schema.devicePairingRequests.status,'PENDING'),lte(schema.devicePairingRequests.expiresAt,input.now))).run();
      const existing=tx.select().from(schema.devices).where(eq(schema.devices.id,input.deviceId)).get();
      if(existing && (existing.status!=='PENDING'||existing.tenantId!==input.tenantId||existing.locationId!==input.locationId||existing.deviceType!==input.deviceType)) throw new Error('DEVICE_ALREADY_REGISTERED');
      const pending=tx.select({pairingId:schema.devicePairingRequests.pairingId}).from(schema.devicePairingRequests)
        .where(and(eq(schema.devicePairingRequests.deviceId,input.deviceId),eq(schema.devicePairingRequests.status,'PENDING'))).get();
      if(pending) throw new Error('DEVICE_ALREADY_REGISTERED');
      if(existing) tx.update(schema.devices).set({name:input.displayName,sessionTimeoutMinutes:input.sessionTimeoutMinutes}).where(eq(schema.devices.id,input.deviceId)).run();
      else tx.insert(schema.devices).values({ id:input.deviceId,tenantId:input.tenantId,locationId:input.locationId,
          name:input.displayName,deviceType:input.deviceType,status:'PENDING',sessionTimeoutMinutes:input.sessionTimeoutMinutes,
          createdAt:input.now,activatedAt:null,revokedAt:null }).run();
      tx.insert(schema.devicePairingRequests).values({ pairingId:input.pairingId,deviceId:input.deviceId,edgeId:input.edgeId,
        tenantId:input.tenantId,locationId:input.locationId,codeHash:input.codeHash,requestTokenHash:input.requestTokenHash,
        credentialHash:input.credentialHash,expiresAt:input.expiresAt,status:'PENDING',createdAt:input.now }).run();
      insertAuditEntry(tx as DB,input.audit);
    });
  }
  appendAudit(entry:NewAuditEntry):void { insertAuditEntry(this.db,entry); }
  auditEntityForCommand(commandId:string,action:NewAuditEntry['action']):string|null {
    return this.db.select({entityId:schema.auditLog.entityId}).from(schema.auditLog)
      .where(and(eq(schema.auditLog.commandId,commandId),eq(schema.auditLog.action,action))).get()?.entityId ?? null;
  }
  getPairing(pairingId:string) {
    return this.db.select({ pairing:schema.devicePairingRequests,device:schema.devices }).from(schema.devicePairingRequests)
      .innerJoin(schema.devices,eq(schema.devices.id,schema.devicePairingRequests.deviceId))
      .where(eq(schema.devicePairingRequests.pairingId,pairingId)).get() ?? null;
  }
  getPairingByRequestTokenHash(hash:string) {
    return this.db.select({ pairing:schema.devicePairingRequests,device:schema.devices }).from(schema.devicePairingRequests)
      .innerJoin(schema.devices,eq(schema.devices.id,schema.devicePairingRequests.deviceId))
      .where(eq(schema.devicePairingRequests.requestTokenHash,hash)).get() ?? null;
  }
  recordFailedAttempt(pairingId:string, now:Date, max:number): number {
    const current=this.getPairing(pairingId); if(!current) return 0;
    const attempts=current.pairing.attemptCount+1;
    this.db.update(schema.devicePairingRequests).set({attemptCount:attempts,lockedUntil:attempts>=max?new Date(now.getTime()+60_000):null})
      .where(and(eq(schema.devicePairingRequests.pairingId,pairingId),eq(schema.devicePairingRequests.status,'PENDING'))).run();
    return attempts;
  }
  activeCount(tenantId:string,locationId:string,type:string):number {
    return this.db.select({id:schema.devices.id}).from(schema.devices).where(and(eq(schema.devices.tenantId,tenantId),
      eq(schema.devices.locationId,locationId),eq(schema.devices.deviceType,type),eq(schema.devices.status,'ACTIVE'))).all().length;
  }
  installation() { return this.db.select().from(schema.installationState).get() ?? null; }
  readinessSnapshot(tenantId:string,locationId:string) {
    const activeUsers=this.db.select({id:schema.users.id}).from(schema.users).where(and(eq(schema.users.tenantId,tenantId),eq(schema.users.locationId,locationId),eq(schema.users.status,'ACTIVE'))).all().length;
    const activeDevices=this.activeCount(tenantId,locationId,'POS')+this.activeCount(tenantId,locationId,'WAITER')+this.activeCount(tenantId,locationId,'KDS');
    const roleCount=this.db.select({id:schema.roles.id}).from(schema.roles).all().length;
    const devicePermissionAssignments=this.db.select({roleId:schema.rolePermissions.roleId,permission:schema.rolePermissions.permissionCode})
      .from(schema.rolePermissions).innerJoin(schema.roles,eq(schema.roles.id,schema.rolePermissions.roleId))
      .where(and(inArray(schema.roles.name,['OWNER','MANAGER']),inArray(schema.rolePermissions.permissionCode,['DEVICE_VIEW','DEVICE_PAIR','DEVICE_REVOKE','INSTALLATION_READINESS_VIEW']))).all().length;
    const productCount=this.db.select({id:schema.products.id}).from(schema.products).where(eq(schema.products.active,true)).all().length;
    const cashRegisters=this.db.select({id:schema.cashRegisters.id}).from(schema.cashRegisters).all().length;
    const stations=this.db.select({id:schema.stations.id}).from(schema.stations).where(and(eq(schema.stations.tenantId,tenantId),eq(schema.stations.locationId,locationId),eq(schema.stations.active,true))).all().length;
    const printTargets=this.db.select({id:schema.printTargets.id}).from(schema.printTargets).where(and(eq(schema.printTargets.tenantId,tenantId),eq(schema.printTargets.locationId,locationId),eq(schema.printTargets.active,true))).all().length;
    const sync=this.db.select().from(schema.syncRuntimeState).get() ?? null;
    return {activeUsers,activeDevices,roleCount,devicePermissionAssignments,productCount,cashRegisters,stations,printTargets,sync,installation:this.installation()};
  }
  approve(input:{ pairingId:string; credentialId:string; approvedByUserId:string; now:Date; audit:NewAuditEntry }):void {
    this.db.transaction((tx)=>{
      const changed=tx.update(schema.devicePairingRequests).set({status:'ACTIVE',consumedAt:input.now,approvedByUserId:input.approvedByUserId})
        .where(and(eq(schema.devicePairingRequests.pairingId,input.pairingId),eq(schema.devicePairingRequests.status,'PENDING'))).run();
      if(changed.changes!==1) throw new Error('PAIRING_ALREADY_CONSUMED');
      const row=tx.select().from(schema.devicePairingRequests).where(eq(schema.devicePairingRequests.pairingId,input.pairingId)).get()!;
      const deviceChanged=tx.update(schema.devices).set({status:'ACTIVE',activatedAt:input.now})
        .where(and(eq(schema.devices.id,row.deviceId),eq(schema.devices.status,'PENDING'))).run();
      if(deviceChanged.changes!==1) throw new Error('PAIRING_ALREADY_CONSUMED');
      tx.insert(schema.deviceCredentials).values({credentialId:input.credentialId,deviceId:row.deviceId,credentialHash:row.credentialHash,createdAt:input.now}).run();
      insertAuditEntry(tx as DB,input.audit);
    });
  }
  completeBootstrap(input:{ pairingId:string; credentialId:string; authorizationId:string; cloudAckCommandId:string; owner:{id:string;displayName:string;pinHash:string}; now:Date; audit:NewAuditEntry }):void {
    this.db.transaction((tx)=>{
      const state=tx.select().from(schema.installationState).get();
      if(!state||state.bootstrapStatus!=='PENDING') throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
      const pending=tx.select().from(schema.devicePairingRequests).where(eq(schema.devicePairingRequests.pairingId,input.pairingId)).get();
      if(!pending) throw new Error('PAIRING_ALREADY_CONSUMED');
      const active=tx.select({id:schema.devices.id}).from(schema.devices).where(and(eq(schema.devices.tenantId,pending.tenantId),eq(schema.devices.locationId,pending.locationId),eq(schema.devices.status,'ACTIVE'))).all();
      if(active.length) throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
      const changed=tx.update(schema.devicePairingRequests).set({status:'ACTIVE',consumedAt:input.now,authorizationId:input.authorizationId})
        .where(and(eq(schema.devicePairingRequests.pairingId,input.pairingId),eq(schema.devicePairingRequests.status,'PENDING'),isNull(schema.devicePairingRequests.authorizationId))).run();
      if(changed.changes!==1) throw new Error('PAIRING_ALREADY_CONSUMED');
      const row=tx.select().from(schema.devicePairingRequests).where(eq(schema.devicePairingRequests.pairingId,input.pairingId)).get()!;
      const ownerRole=tx.select({id:schema.roles.id}).from(schema.roles).where(eq(schema.roles.name,'OWNER')).get();
      if(!ownerRole) throw new Error('INSTALLATION_BOOTSTRAP_CLOSED');
      tx.insert(schema.users).values({id:input.owner.id,tenantId:row.tenantId,locationId:row.locationId,displayName:input.owner.displayName,status:'ACTIVE',pinHash:input.owner.pinHash,createdAt:input.now}).run();
      tx.insert(schema.userRoles).values({userId:input.owner.id,roleId:ownerRole.id}).run();
      const deviceChanged=tx.update(schema.devices).set({status:'ACTIVE',activatedAt:input.now}).where(and(eq(schema.devices.id,row.deviceId),eq(schema.devices.status,'PENDING'))).run();
      if(deviceChanged.changes!==1) throw new Error('PAIRING_ALREADY_CONSUMED');
      tx.insert(schema.deviceCredentials).values({credentialId:input.credentialId,deviceId:row.deviceId,credentialHash:row.credentialHash,createdAt:input.now}).run();
      tx.update(schema.installationState).set({bootstrapStatus:'COMPLETED',completedAt:input.now,authorizationId:input.authorizationId,firstDeviceId:row.deviceId,initialOwnerUserId:input.owner.id,cloudAckCommandId:input.cloudAckCommandId}).where(eq(schema.installationState.singletonKey,'PRIMARY')).run();
      insertAuditEntry(tx as DB,input.audit);
    });
  }
  revoke(input:{deviceId:string;tenantId:string;locationId:string;now:Date;audit:NewAuditEntry}):void {
    this.db.transaction((tx)=>{
      const changed=tx.update(schema.devices).set({status:'REVOKED',revokedAt:input.now}).where(and(eq(schema.devices.id,input.deviceId),eq(schema.devices.tenantId,input.tenantId),eq(schema.devices.locationId,input.locationId),eq(schema.devices.status,'ACTIVE'))).run();
      if(changed.changes!==1) throw new Error('DEVICE_NOT_AUTHORIZED');
      tx.update(schema.deviceCredentials).set({revokedAt:input.now}).where(and(eq(schema.deviceCredentials.deviceId,input.deviceId),isNull(schema.deviceCredentials.revokedAt))).run();
      tx.update(schema.authSessions).set({revokedAt:input.now}).where(and(eq(schema.authSessions.deviceId,input.deviceId),isNull(schema.authSessions.revokedAt))).run();
      insertAuditEntry(tx as DB,input.audit);
    });
  }
  cancel(input:{pairingId:string;now:Date;audit:NewAuditEntry}):boolean { return this.db.transaction((tx)=>{
    const changed=tx.update(schema.devicePairingRequests).set({status:'CANCELLED',consumedAt:input.now}).where(and(eq(schema.devicePairingRequests.pairingId,input.pairingId),eq(schema.devicePairingRequests.status,'PENDING'))).run();
    if(changed.changes===1) insertAuditEntry(tx as DB,input.audit);
    return changed.changes===1;
  }); }
}
