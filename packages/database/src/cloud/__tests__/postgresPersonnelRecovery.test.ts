import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createCloudDatabase } from '../db.js';
import { migrateCloudDatabase } from '../migrate.js';
import { CloudLicensingRepository } from '../repositories/CloudLicensingRepository.js';
import { CloudPersonnelRecoveryRepository } from '../repositories/CloudPersonnelRecoveryRepository.js';
import type { OwnerRecoveryAuthorizationPayload } from '@comanview/contracts';

const url=process.env['COMANVIEW_TEST_POSTGRES_URL'];
describe.skipIf(!url)('PostgreSQL 1W contractual owner and recovery',()=>{
  const db=createCloudDatabase(url!),repo=new CloudPersonnelRecoveryRepository(db.pool),licensing=new CloudLicensingRepository(db.pool),id=randomUUID;
  const tenantId=id(),locationId=id(),edgeId=id(),ownerUserId=id(),userId=id(),sessionId=id(),now=new Date();
  const actor={userId,sessionId};
  const signing={kid:'isolated-test',sign:(p:OwnerRecoveryAuthorizationPayload)=>({protected:'isolated',payload:JSON.stringify(p),signature:'isolated'})};
  const context=()=>({tenantId,locationId,sourceEdgeId:edgeId,targetEdgeId:edgeId,recoveryId:id(),backupId:id(),recoveryEpoch:1,
    restoreAuthorizationId:null,trustDomainId:id(),accessGeneration:1,challengeId:id(),deviceId:id(),pairingId:null});
  beforeAll(async()=>{
    await migrateCloudDatabase(url!);
    await db.pool.query("INSERT INTO cloud_admin_users(user_id,email,display_name,credential_hash,role,status,created_at,updated_at) VALUES($1,$2,'Fixture','fixture','PLATFORM_ADMIN','ACTIVE',$3,$3)",[userId,`${userId}@test.invalid`,now]);
    await db.pool.query('INSERT INTO cloud_admin_sessions(session_id,user_id,token_hash,created_at,last_activity_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)',[sessionId,userId,id(),now,new Date(now.getTime()+3600000)]);
    await db.pool.query("INSERT INTO cloud_tenants(tenant_id,display_name,status,created_at,updated_at) VALUES($1,'Fixture','ACTIVE',$2,$2)",[tenantId,now]);
    await db.pool.query("INSERT INTO cloud_locations(location_id,tenant_id,display_name,timezone,status,created_at,updated_at) VALUES($1,$2,'Fixture','UTC','ACTIVE',$3,$3)",[locationId,tenantId,now]);
    await db.pool.query("INSERT INTO edges(edge_id,tenant_id,location_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',$4,$4)",[edgeId,tenantId,locationId,now]);
  });
  afterAll(async()=>{await db.pool.query('DELETE FROM cloud_owner_recovery_authorizations WHERE tenant_id=$1',[tenantId]);
    await db.pool.query('DELETE FROM cloud_contractual_owners WHERE tenant_id=$1',[tenantId]);
    await db.pool.query('DELETE FROM cloud_installation_authorizations WHERE tenant_id=$1',[tenantId]);
    await db.pool.query('DELETE FROM cloud_admin_audit_log WHERE tenant_id=$1',[tenantId]);
    await db.pool.query('DELETE FROM cloud_admin_audit_chain_heads WHERE scope_key=$1',[`TENANT:${tenantId}`]);
    await db.pool.query('DELETE FROM edges WHERE tenant_id=$1',[tenantId]);await db.pool.query('DELETE FROM cloud_locations WHERE tenant_id=$1',[tenantId]);
    await db.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1',[tenantId]);await db.pool.query('DELETE FROM cloud_admin_sessions WHERE session_id=$1',[sessionId]);
    await db.pool.query('DELETE FROM cloud_admin_users WHERE user_id=$1',[userId]);await db.close();});
  it('requires authoritative mapping, created atomically by Cloud bootstrap issuance',async()=>{
    await expect(repo.issue({commandId:id(),context:context(),reason:'Test recovery'},actor,now,signing)).rejects.toThrow('CONTRACTUAL_OWNER_MAPPING_REQUIRED');
    await licensing.issueInstallationAuthorization({authorizationId:id(),tenantId,locationId,edgeId,pairingId:id(),pairingCodeHash:'a'.repeat(64),deviceId:id(),deviceType:'POS',displayName:'POS',
      initialOwnerId:ownerUserId,initialOwnerDisplayName:'Owner',kid:'test',envelope:{protected:'test',payload:'test',signature:'test'},commandId:id(),reason:'Test bootstrap',actor,issuedAt:now,expiresAt:new Date(now.getTime()+600000)});
    expect(await licensing.contractualOwner(locationId)).toBe(ownerUserId);
  });
  it('issues an exact owner, retries once logically, rejects changed input and consumes with retryable ACK',async()=>{
    const request={commandId:id(),context:context(),reason:'Test recovery'},issued=await repo.issue(request,actor,now,signing);
    expect(JSON.parse(issued.authorization.payload).ownerUserId).toBe(ownerUserId);
    expect((await repo.issue(request,actor,now,signing)).authorizationId).toBe(issued.authorizationId);
    await expect(repo.issue({...request,reason:'Different request'},actor,now,signing)).rejects.toThrow('COMMAND_ID_CONFLICT');
    const ack={authorizationId:issued.authorizationId,commandId:id(),consumedAt:new Date(now.getTime()+1000)};
    await repo.consume(edgeId,ack);await repo.consume(edgeId,ack);
    await expect(repo.consume(edgeId,{...ack,commandId:id()})).rejects.toThrow('OWNER_RECOVERY_AUTHORIZATION_CONSUMED');
    expect((await db.pool.query('SELECT * FROM cloud_admin_audit_log WHERE entity_id=$1',[issued.authorizationId])).rowCount).toBe(2);
  });
  it('serializes duplicate generation, rejects expired ACK and mismatched target binding',async()=>{
    const c=context(),request={commandId:id(),context:c,reason:'Concurrent test'};
    const outcomes=await Promise.allSettled([repo.issue(request,actor,now,signing),repo.issue({...request,commandId:id()},actor,now,signing)]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
    const result=outcomes.find(x=>x.status==='fulfilled');if(result?.status!=='fulfilled')throw new Error('Missing accepted command');
    await expect(repo.consume(edgeId,{authorizationId:result.value.authorizationId,commandId:id(),consumedAt:new Date(now.getTime()+600001)})).rejects.toThrow('OWNER_RECOVERY_AUTHORIZATION_CONSUMED');
    await expect(repo.issue({commandId:id(),context:{...context(),targetEdgeId:id()},reason:'Wrong Edge'},actor,now,signing)).rejects.toThrow('OWNER_RECOVERY_BINDING_INVALID');
  });
});
