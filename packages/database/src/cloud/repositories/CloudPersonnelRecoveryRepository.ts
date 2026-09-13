import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { OwnerRecoveryAuthorizationEnvelopeSchema, OwnerRecoveryAuthorizationPayloadSchema, IssueOwnerRecoveryAuthorizationRequestSchema,
  type IssueOwnerRecoveryAuthorizationRequest,type OwnerRecoveryAuthorizationEnvelope,type OwnerRecoveryAuthorizationPayload } from '@comanview/contracts';
import { EntityId } from '@comanview/domain';
import { appendCloudAdminAudit,type CloudAdminMutationActor } from './CloudControlPlaneRepository.js';
import { RecoveryAuthorizationConflictError } from './CloudRecoveryRepository.js';

type Stored={authorization_id:string;tenant_id:string;location_id:string;target_edge_id:string;request_digest:string;
  status:'ISSUED'|'CONSUMED'|'EXPIRED'|'REVOKED';issued_at:Date;expires_at:Date;envelope:unknown;consumed_command_id:string|null};
export class CloudPersonnelRecoveryRepository{
  constructor(private pool:Pool){}
  async issue(raw:IssueOwnerRecoveryAuthorizationRequest,actor:CloudAdminMutationActor,now:Date,
    signing:{kid:string;sign(payload:OwnerRecoveryAuthorizationPayload):OwnerRecoveryAuthorizationEnvelope}){
    const input=IssueOwnerRecoveryAuthorizationRequestSchema.parse(raw),c=input.context;
    const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(async db=>{
      const owner=(await db.query<{owner_user_id:string;tenant_id:string}>(
        'SELECT owner_user_id,tenant_id FROM cloud_contractual_owners WHERE location_id=$1 FOR UPDATE',[c.locationId])).rows[0];
      if(!owner||owner.tenant_id!==c.tenantId)throw conflict('CONTRACTUAL_OWNER_MAPPING_REQUIRED');
      const prior=(await db.query<Stored>('SELECT * FROM cloud_owner_recovery_authorizations WHERE command_id=$1',[input.commandId])).rows[0];
      if(prior){if(prior.request_digest!==digest)throw conflict('COMMAND_ID_CONFLICT');return result(prior);}
      const edges=(await db.query<{edge_id:string;tenant_id:string;location_id:string;status:string}>(
        'SELECT edge_id,tenant_id,location_id,status FROM edges WHERE edge_id=ANY($1::uuid[]) ORDER BY edge_id FOR UPDATE',[[c.sourceEdgeId,c.targetEdgeId]])).rows;
      const source=edges.find(e=>e.edge_id===c.sourceEdgeId),target=edges.find(e=>e.edge_id===c.targetEdgeId);
      if(!source||!target||target.status!=='ACTIVE'||edges.some(e=>e.tenant_id!==c.tenantId||e.location_id!==c.locationId))throw conflict('OWNER_RECOVERY_BINDING_INVALID');
      if(c.restoreAuthorizationId){
        const restore=(await db.query<{source_edge_id:string;target_edge_id:string;backup_id:string;recovery_epoch:number;status:string}>(
          'SELECT source_edge_id,target_edge_id,backup_id,recovery_epoch,status FROM cloud_recovery_authorizations WHERE authorization_id=$1',[c.restoreAuthorizationId])).rows[0];
        if(source.status!=='REPLACED'||!restore||!['ISSUED','CONSUMED'].includes(restore.status)||restore.source_edge_id!==c.sourceEdgeId||
          restore.target_edge_id!==c.targetEdgeId||restore.backup_id!==c.backupId||Number(restore.recovery_epoch)!==c.recoveryEpoch)throw conflict('OWNER_RECOVERY_BINDING_INVALID');
      }else if(c.sourceEdgeId!==c.targetEdgeId)throw conflict('OWNER_RECOVERY_BINDING_INVALID');
      const maximum=(await db.query<{epoch:number}>(`SELECT GREATEST(
        COALESCE((SELECT max(recovery_epoch) FROM cloud_sync_inbox WHERE edge_id=$1),0),
        COALESCE((SELECT max(recovery_epoch) FROM cloud_recovery_authorizations WHERE target_edge_id=$1),0),
        COALESCE((SELECT max(recovery_epoch) FROM cloud_owner_recovery_authorizations WHERE target_edge_id=$1),0)) AS epoch`,[c.targetEdgeId])).rows[0];
      if(Number(maximum?.epoch??0)>c.recoveryEpoch)throw conflict('OWNER_RECOVERY_EPOCH_STALE');
      const generation=(await db.query<{generation:string|null}>(`SELECT max(access_generation) AS generation FROM cloud_owner_recovery_authorizations
        WHERE target_edge_id=$1 AND trust_domain_id=$2`,[c.targetEdgeId,c.trustDomainId])).rows[0]?.generation;
      if(generation!=null&&Number(generation)>=c.accessGeneration)throw conflict('OWNER_RECOVERY_GENERATION_STALE');
      const payload=OwnerRecoveryAuthorizationPayloadSchema.parse({...c,formatVersion:1,typ:'comanview-owner-recovery-authorization',purpose:'RESTORE_CONTRACTUAL_OWNER',
        ownerUserId:owner.owner_user_id,authorizationId:EntityId.generate().toString(),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+600_000).toISOString()});
      const envelope=signing.sign(payload);
      await db.query(`UPDATE cloud_owner_recovery_authorizations SET status='EXPIRED' WHERE target_edge_id=$1 AND status='ISSUED' AND expires_at<=$2`,[c.targetEdgeId,now]);
      const row=(await db.query<Stored>(`INSERT INTO cloud_owner_recovery_authorizations(authorization_id,tenant_id,location_id,target_edge_id,owner_user_id,
        recovery_epoch,trust_domain_id,access_generation,challenge_id,request_digest,kid,envelope,status,command_id,issued_by_admin_user_id,issued_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ISSUED',$13,$14,$15,$16) RETURNING *`,
        [payload.authorizationId,c.tenantId,c.locationId,c.targetEdgeId,owner.owner_user_id,c.recoveryEpoch,c.trustDomainId,c.accessGeneration,c.challengeId,
          digest,signing.kid,JSON.stringify(envelope),input.commandId,actor.userId,now,new Date(payload.expiresAt)])).rows[0]!;
      await appendCloudAdminAudit(db,{actor,action:'OWNER_RECOVERY_AUTHORIZATION_ISSUED',entityType:'OWNER_RECOVERY_AUTHORIZATION',entityId:payload.authorizationId,
        tenantId:c.tenantId,locationId:c.locationId,edgeId:c.targetEdgeId,commandId:input.commandId,reason:input.reason,
        after:{ownerUserId:owner.owner_user_id,recoveryId:c.recoveryId,accessGeneration:c.accessGeneration},now});
      return result(row);
    });
  }
  async consume(edgeId:string,input:{authorizationId:string;commandId:string;consumedAt:Date}){
    await this.transaction(async db=>{
      const row=(await db.query<Stored>('SELECT * FROM cloud_owner_recovery_authorizations WHERE authorization_id=$1 FOR UPDATE',[input.authorizationId])).rows[0];
      if(!row||row.target_edge_id!==edgeId)throw conflict('OWNER_RECOVERY_AUTHORIZATION_INVALID');
      if(row.status==='CONSUMED'&&row.consumed_command_id===input.commandId)return;
      if(row.status!=='ISSUED'||!Number.isFinite(input.consumedAt.getTime())||input.consumedAt<row.issued_at||input.consumedAt>=row.expires_at)
        throw conflict('OWNER_RECOVERY_AUTHORIZATION_CONSUMED');
      await db.query("UPDATE cloud_owner_recovery_authorizations SET status='CONSUMED',consumed_at=$2,consumed_command_id=$3 WHERE authorization_id=$1",
        [input.authorizationId,input.consumedAt,input.commandId]);
      await appendCloudAdminAudit(db,{actor:null,action:'OWNER_RECOVERY_AUTHORIZATION_CONSUMED',entityType:'OWNER_RECOVERY_AUTHORIZATION',entityId:input.authorizationId,
        tenantId:row.tenant_id,locationId:row.location_id,edgeId,commandId:input.commandId,reason:'Owner recovery consumed by exact target Edge.',after:{status:'CONSUMED'},now:input.consumedAt});
    });
  }
  private async transaction<T>(run:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');const value=await run(db);await db.query('COMMIT');return value;}
    catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
}
const conflict=(code:string)=>new RecoveryAuthorizationConflictError(code);
function result(row:Stored){return {authorizationId:row.authorization_id,status:row.status,expiresAt:row.expires_at.toISOString(),authorization:OwnerRecoveryAuthorizationEnvelopeSchema.parse(row.envelope)};}
