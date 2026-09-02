import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createCloudDatabase } from '../db.js';import { migrateCloudDatabase } from '../migrate.js';
import { CloudRecoveryRepository,RecoveryAuthorizationConflictError } from '../repositories/CloudRecoveryRepository.js';

const url=process.env['COMANVIEW_TEST_POSTGRES_URL'];
const ids={tenant:'01991a00-3000-7000-8000-000000000001',location:'01991a00-3000-7000-8000-000000000002',
  source:'01991a00-3000-7000-8000-000000000003',target:'01991a00-3000-7000-8000-000000000004',
  user:'01991a00-3000-7000-8000-000000000005',session:'01991a00-3000-7000-8000-000000000006'};
describe.skipIf(!url)('Cloud PostgreSQL recovery authorization',()=>{const database=createCloudDatabase(url!);const repo=new CloudRecoveryRepository(database.pool);
  const now=new Date('2026-09-01T00:00:00.000Z'),actor={userId:ids.user,sessionId:ids.session};
  beforeAll(async()=>{await migrateCloudDatabase(url!);await database.pool.query('DELETE FROM cloud_recovery_authorizations WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_admin_audit_log WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_admin_audit_chain_heads WHERE scope_key=$1',[`TENANT:${ids.tenant}`]);
    await database.pool.query('DELETE FROM edges WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_locations WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_admin_sessions WHERE session_id=$1',[ids.session]);await database.pool.query('DELETE FROM cloud_admin_users WHERE user_id=$1',[ids.user]);
    await database.pool.query(`INSERT INTO cloud_admin_users(user_id,email,display_name,credential_hash,role,status,created_at,updated_at)
      VALUES($1,'recovery@test.invalid','Recovery Test','hash','PLATFORM_ADMIN','ACTIVE',$2,$2)`,[ids.user,now]);
    await database.pool.query(`INSERT INTO cloud_admin_sessions(session_id,user_id,token_hash,created_at,last_activity_at,expires_at)
      VALUES($1,$2,'hash',$3,$3,$4)`,[ids.session,ids.user,now,new Date(now.getTime()+3600_000)]);
    await database.pool.query(`INSERT INTO cloud_tenants(tenant_id,display_name,status,created_at,updated_at) VALUES($1,'Recovery Tenant','ACTIVE',$2,$2)`,[ids.tenant,now]);
    await database.pool.query(`INSERT INTO cloud_locations(location_id,tenant_id,display_name,timezone,status,created_at,updated_at) VALUES($1,$2,'Recovery Location','UTC','ACTIVE',$3,$3)`,[ids.location,ids.tenant,now]);
    await database.pool.query(`INSERT INTO edges(edge_id,tenant_id,location_id,status,created_at,updated_at,replaced_at,replaced_by_edge_id)
      VALUES($1,$3,$4,'REPLACED',$5,$5,$5,$2),($2,$3,$4,'ACTIVE',$5,$5,NULL,NULL)`,[ids.source,ids.target,ids.tenant,ids.location,now]);});
  afterAll(async()=>{await database.pool.query('DELETE FROM cloud_recovery_authorizations WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_admin_audit_log WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_admin_audit_chain_heads WHERE scope_key=$1',[`TENANT:${ids.tenant}`]);await database.pool.query('DELETE FROM edges WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_locations WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1',[ids.tenant]);await database.pool.query('DELETE FROM cloud_admin_sessions WHERE session_id=$1',[ids.session]);await database.pool.query('DELETE FROM cloud_admin_users WHERE user_id=$1',[ids.user]);await database.close();});
  it('issues idempotently and consumes exactly once for the ACTIVE target Edge',async()=>{const input={authorizationId:'01991a00-3000-7000-8000-000000000010',commandId:'01991a00-3000-7000-8000-000000000011',sourceEdgeId:ids.source,targetEdgeId:ids.target,backupId:'01991a00-3000-7000-8000-000000000012',recoveryEpoch:1,kid:'test',envelope:{protected:'p',payload:'p',signature:'s'},expiresAt:new Date(now.getTime()+1800_000),reason:'Recovery test',actor,now};
    await expect(repo.issue(input)).resolves.toMatchObject({status:'ISSUED',recoveryEpoch:1});await expect(repo.issue({...input,authorizationId:'01991a00-3000-7000-8000-000000000099'})).resolves.toMatchObject({authorizationId:input.authorizationId});
    await expect(repo.consume(ids.target,{authorizationId:input.authorizationId,commandId:'01991a00-3000-7000-8000-000000000013',consumedAt:new Date(now.getTime()+60_000)})).resolves.toBeUndefined();
    await expect(repo.consume(ids.target,{authorizationId:input.authorizationId,commandId:'01991a00-3000-7000-8000-000000000013',consumedAt:new Date(now.getTime()+60_000)})).resolves.toBeUndefined();
    await expect(repo.consume(ids.target,{authorizationId:input.authorizationId,commandId:'01991a00-3000-7000-8000-000000000014',consumedAt:new Date(now.getTime()+60_000)})).rejects.toBeInstanceOf(RecoveryAuthorizationConflictError);
    const audit=await database.pool.query<{action:string}>('SELECT action FROM cloud_admin_audit_log WHERE entity_id=$1 ORDER BY occurred_at',[input.authorizationId]);expect(audit.rows.map(x=>x.action)).toEqual(['RECOVERY_AUTHORIZATION_ISSUED','RECOVERY_AUTHORIZATION_CONSUMED']);
  });
});
