import type { Pool,PoolClient } from 'pg';
import type { RecoveryAuthorizationEnvelope } from '@comanview/contracts';
import { appendCloudAdminAudit,type CloudAdminMutationActor } from './CloudControlPlaneRepository.js';

export interface RecoveryAuthorizationRecord {authorizationId:string;tenantId:string;locationId:string;
  sourceEdgeId:string;targetEdgeId:string;backupId:string;recoveryEpoch:number;status:'ISSUED'|'CONSUMED'|'EXPIRED'|'REVOKED';
  expiresAt:Date;envelope:RecoveryAuthorizationEnvelope}
export class RecoveryAuthorizationConflictError extends Error {constructor(readonly code:string){super(code);}}

export class CloudRecoveryRepository {
  constructor(private readonly pool:Pool){}
  async binding(sourceEdgeId:string,targetEdgeId:string):Promise<{tenantId:string;locationId:string}>{
    const result=await this.pool.query<{edge_id:string;tenant_id:string;location_id:string;status:string}>(
      'SELECT edge_id,tenant_id,location_id,status FROM edges WHERE edge_id=ANY($1::uuid[])',[[sourceEdgeId,targetEdgeId]]);
    const source=result.rows.find(x=>x.edge_id===sourceEdgeId),target=result.rows.find(x=>x.edge_id===targetEdgeId);
    if(!source||!target||source.tenant_id!==target.tenant_id||source.location_id!==target.location_id||source.status!=='REPLACED'||target.status!=='ACTIVE')
      throw new RecoveryAuthorizationConflictError('RECOVERY_EDGE_BINDING_INVALID');
    return {tenantId:source.tenant_id,locationId:source.location_id};
  }
  async issue(input:{authorizationId:string;commandId:string;sourceEdgeId:string;targetEdgeId:string;backupId:string;
    recoveryEpoch:number;kid:string;envelope:RecoveryAuthorizationEnvelope;expiresAt:Date;reason:string;actor:CloudAdminMutationActor;now:Date}):Promise<RecoveryAuthorizationRecord>{
    return this.transaction(async(client)=>{
      const prior=await client.query<any>('SELECT * FROM cloud_recovery_authorizations WHERE command_id=$1',[input.commandId]);
      if(prior.rows[0])return map(prior.rows[0]);
      const edges=await client.query<{edge_id:string;tenant_id:string;location_id:string;status:string}>(
        'SELECT edge_id,tenant_id,location_id,status FROM edges WHERE edge_id=ANY($1::uuid[]) FOR UPDATE',[[input.sourceEdgeId,input.targetEdgeId]]);
      const source=edges.rows.find(x=>x.edge_id===input.sourceEdgeId),target=edges.rows.find(x=>x.edge_id===input.targetEdgeId);
      if(!source||!target||source.tenant_id!==target.tenant_id||source.location_id!==target.location_id)
        throw new RecoveryAuthorizationConflictError('RECOVERY_EDGE_BINDING_INVALID');
      if(source.status!=='REPLACED'||target.status!=='ACTIVE')throw new RecoveryAuthorizationConflictError('RECOVERY_EDGE_LIFECYCLE_INVALID');
      await client.query(`UPDATE cloud_recovery_authorizations SET status='EXPIRED'
        WHERE target_edge_id=$1 AND status='ISSUED' AND expires_at<=$2`,[input.targetEdgeId,input.now]);
      const epochResult=await client.query<{next_epoch:number}>(`SELECT GREATEST(
        COALESCE((SELECT max(recovery_epoch) FROM cloud_sync_inbox WHERE edge_id=ANY($1::uuid[])),0),
        COALESCE((SELECT max(recovery_epoch) FROM cloud_recovery_authorizations WHERE target_edge_id=$2),0))+1 AS next_epoch`,
        [[input.sourceEdgeId,input.targetEdgeId],input.targetEdgeId]);
      const epoch=Number(epochResult.rows[0]?.next_epoch??1);
      if(epoch!==input.recoveryEpoch)throw new RecoveryAuthorizationConflictError('RECOVERY_EPOCH_CHANGED');
      await client.query(`INSERT INTO cloud_recovery_authorizations(authorization_id,tenant_id,location_id,source_edge_id,
        target_edge_id,backup_id,recovery_epoch,purpose,kid,envelope,status,command_id,issued_by_admin_user_id,issued_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'HARDWARE_REPLACEMENT_RESTORE',$8,$9,'ISSUED',$10,$11,$12,$13)`,
        [input.authorizationId,source.tenant_id,source.location_id,input.sourceEdgeId,input.targetEdgeId,input.backupId,epoch,input.kid,
          JSON.stringify(input.envelope),input.commandId,input.actor.userId,input.now,input.expiresAt]);
      await appendCloudAdminAudit(client,{actor:input.actor,action:'RECOVERY_AUTHORIZATION_ISSUED',
        entityType:'RECOVERY_AUTHORIZATION',entityId:input.authorizationId,tenantId:source.tenant_id,locationId:source.location_id,
        edgeId:input.targetEdgeId,commandId:input.commandId,reason:input.reason,before:null,
        after:{authorizationId:input.authorizationId,backupId:input.backupId,recoveryEpoch:epoch,status:'ISSUED'},now:input.now});
      return {authorizationId:input.authorizationId,tenantId:source.tenant_id,locationId:source.location_id,sourceEdgeId:input.sourceEdgeId,
        targetEdgeId:input.targetEdgeId,backupId:input.backupId,recoveryEpoch:epoch,status:'ISSUED',expiresAt:input.expiresAt,envelope:input.envelope};
    });
  }
  async nextEpoch(sourceEdgeId:string,targetEdgeId:string){const r=await this.pool.query<{next_epoch:number}>(`SELECT GREATEST(
    COALESCE((SELECT max(recovery_epoch) FROM cloud_sync_inbox WHERE edge_id=ANY($1::uuid[])),0),
    COALESCE((SELECT max(recovery_epoch) FROM cloud_recovery_authorizations WHERE target_edge_id=$2),0))+1 AS next_epoch`,[[sourceEdgeId,targetEdgeId],targetEdgeId]);return Number(r.rows[0]?.next_epoch??1);}
  async consume(targetEdgeId:string,input:{authorizationId:string;commandId:string;consumedAt:Date}){return this.transaction(async(client)=>{
    const row=await client.query<any>('SELECT * FROM cloud_recovery_authorizations WHERE authorization_id=$1 FOR UPDATE',[input.authorizationId]);
    const current=row.rows[0];if(!current||current.target_edge_id!==targetEdgeId)throw new RecoveryAuthorizationConflictError('RECOVERY_AUTHORIZATION_INVALID');
    if(current.status==='CONSUMED'&&current.consumed_command_id===input.commandId)return;
    if(current.status!=='ISSUED')throw new RecoveryAuthorizationConflictError('RECOVERY_AUTHORIZATION_CONSUMED');
    if(new Date(current.expires_at)<=input.consumedAt)
      throw new RecoveryAuthorizationConflictError('RECOVERY_AUTHORIZATION_EXPIRED');
    const changed=await client.query(`UPDATE cloud_recovery_authorizations SET status='CONSUMED',consumed_at=$3,consumed_command_id=$4
      WHERE authorization_id=$1 AND target_edge_id=$2 AND status='ISSUED'`,[input.authorizationId,targetEdgeId,input.consumedAt,input.commandId]);
    if(changed.rowCount!==1)throw new RecoveryAuthorizationConflictError('RECOVERY_AUTHORIZATION_CONSUMED');
    await appendCloudAdminAudit(client,{actor:null,action:'RECOVERY_AUTHORIZATION_CONSUMED',
      entityType:'RECOVERY_AUTHORIZATION',entityId:input.authorizationId,tenantId:current.tenant_id,
      locationId:current.location_id,edgeId:targetEdgeId,commandId:input.commandId,
      reason:'Recovery authorization consumed by target Edge.',before:{status:'ISSUED'},after:{status:'CONSUMED'},now:input.consumedAt});
  });}
  private async transaction<T>(work:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
function map(row:any):RecoveryAuthorizationRecord{return {authorizationId:row.authorization_id,tenantId:row.tenant_id,locationId:row.location_id,
  sourceEdgeId:row.source_edge_id,targetEdgeId:row.target_edge_id,backupId:row.backup_id,recoveryEpoch:Number(row.recovery_epoch),
  status:row.status,expiresAt:new Date(row.expires_at),envelope:row.envelope};}
