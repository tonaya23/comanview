import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CloudControlPlaneRepository,
  CloudLicensingRepository,
  LicensingConflictError,
  createCloudDatabase,
  migrateCloudDatabase,
} from '@comanview/database';
import { PairingAuthorizationDataSchema } from '@comanview/contracts';
import { verifyControlDocument, verifyInstallationAuthorization } from '@comanview/licensing';
import { CloudLicensingService } from './CloudLicensingService.js';

const databaseUrl = process.env['COMANVIEW_TEST_POSTGRES_URL'];
const ids = {
  user: '01991a00-3000-7000-8000-000000000001', session: '01991a00-3000-7000-8000-000000000002',
  tenant: '01991a00-3000-7000-8000-000000000003', location: '01991a00-3000-7000-8000-000000000004',
  edge: '01991a00-3000-7000-8000-000000000005', credential: '01991a00-3000-7000-8000-000000000006',
};

describe.skipIf(!databaseUrl)('Cloud PostgreSQL signed licensing', () => {
  const database = createCloudDatabase(databaseUrl!);
  const repository = new CloudLicensingRepository(database.pool);
  const control = new CloudControlPlaneRepository(database.pool);
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const now = new Date('2026-08-29T12:00:00.000Z');
  const service = new CloudLicensingService(repository, { signingKid: 'test-current', privateKeyPem }, () => now);
  const actor = { userId: ids.user, sessionId: ids.session };

  beforeAll(async () => {
    await migrateCloudDatabase(databaseUrl!);
    await cleanup();
    await database.pool.query(`INSERT INTO cloud_admin_users
      (user_id,email,display_name,credential_hash,role,status,created_at,updated_at)
      VALUES($1,'licensing@test.invalid','Licensing Test','not-secret','PLATFORM_ADMIN','ACTIVE',$2,$2)`, [ids.user,now]);
    await database.pool.query(`INSERT INTO cloud_admin_sessions
      (session_id,user_id,token_hash,created_at,last_activity_at,expires_at)
      VALUES($1,$2,'licensing-test-token-hash',$3,$3,$4)`, [ids.session,ids.user,now,new Date(now.getTime()+60_000)]);
    await control.createTenant({ tenantId: ids.tenant, displayName: 'Licensing Tenant',
      commandId: '01991a00-3000-7000-8000-000000000010', actor, now });
    await control.createLocation({ tenantId: ids.tenant, locationId: ids.location,
      displayName: 'Licensing Location', timezone: 'America/Matamoros',
      commandId: '01991a00-3000-7000-8000-000000000011', actor, now });
    await database.pool.query(`INSERT INTO edges
      (edge_id,tenant_id,location_id,status,created_at,updated_at,provisioned_at,activated_at)
      VALUES($1,$2,$3,'ACTIVE',$4,$4,$4,$4)`, [ids.edge,ids.tenant,ids.location,now]);
    await database.pool.query(`INSERT INTO edge_credentials
      (credential_id,edge_id,credential_hash,status,issued_at,activated_at)
      VALUES($1,$2,repeat('a',64),'ACTIVE',$3,$3)`, [ids.credential,ids.edge,now]);
  });

  afterAll(async () => { await cleanup(); await database.close(); });

  it('assigns a plan, emits separate signed streams, enforces OCC and stores idempotent ACK', async () => {
    const plan = await service.createPlan({ commandId: '01991a00-3000-7000-8000-000000000012',
      code: 'TEST_PLAN', displayName: 'Test Plan', capabilities: ['CORE_POS','KDS'],
      deviceLimits:{POS:2,WAITER:null,KDS:1}, reason: 'test setup' }, actor);
    const assigned = await service.assignLocation(ids.location, {
      commandId: '01991a00-3000-7000-8000-000000000013', expectedRevision: 0,
      planId: plan.planId, declaredState: 'ACTIVE', reason: 'initial assignment',
      configuration: { payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000,1500] } },
    }, actor);
    expect(assigned.revision).toBe(1);

    const controlState = await service.controlState(ids.edge);
    expect(controlState.license).not.toBeNull();
    expect(controlState.configuration).not.toBeNull();
    expect(controlState.featureFlags).not.toBeNull();
    const verified = verifyControlDocument(controlState.license!.envelope, { 'test-current': publicKeyPem });
    expect(verified.payload).toMatchObject({ documentType: 'LICENSE', edgeId: ids.edge,
      declaredState: 'ACTIVE', capabilities: ['CORE_POS','KDS'],deviceLimits:{POS:2,WAITER:null,KDS:1} });

    const authorizationCommand='01991a00-3000-7000-8000-000000000018';
    const pairingTransfer=PairingAuthorizationDataSchema.parse({schemaVersion:1,
      pairingId:'01991a00-3000-7000-8000-000000000019',pairingCode:'123456',
      deviceId:'01991a00-3000-7000-8000-000000000020',deviceType:'POS',displayName:'POS principal'});
    const authorizationInput={commandId:authorizationCommand,pairingId:pairingTransfer.pairingId,
      pairingCode:pairingTransfer.pairingCode,deviceId:pairingTransfer.deviceId,deviceType:pairingTransfer.deviceType,
      displayName:pairingTransfer.displayName,initialOwnerDisplayName:'Owner inicial',reason:'first installation test'};
    const authorization=await service.issueInstallationAuthorization(ids.location,authorizationInput,actor);
    expect(verifyInstallationAuthorization(authorization.authorization,{'test-current':publicKeyPem}).payload)
      .toMatchObject({pairingId:pairingTransfer.pairingId,deviceId:pairingTransfer.deviceId,
        deviceType:'POS',displayName:'POS principal'});
    const authorizationRetry=await service.issueInstallationAuthorization(ids.location,authorizationInput,actor);
    expect(authorizationRetry).toEqual(authorization);
    expect(authorization.authorization).toEqual(authorizationRetry.authorization);
    await expect(service.issueInstallationAuthorization(ids.location,{...authorizationInput,
      commandId:'01991a00-3000-7000-8000-000000000022'},actor)).rejects.toMatchObject({code:'INSTALLATION_AUTHORIZATION_PENDING'});
    await service.consumeInstallationAuthorization(ids.edge,{commandId:'01991a00-3000-7000-8000-000000000021',authorizationId:authorization.authorizationId,consumedAt:now.toISOString()});
    await service.consumeInstallationAuthorization(ids.edge,{commandId:'01991a00-3000-7000-8000-000000000021',authorizationId:authorization.authorizationId,consumedAt:now.toISOString()});
    const consumed=await database.pool.query('SELECT status,consumed_at FROM cloud_installation_authorizations WHERE authorization_id=$1',[authorization.authorizationId]);
    expect(consumed.rows[0]).toMatchObject({status:'CONSUMED',consumed_at:now});
    expect(await service.getLatestInstallationAuthorization(ids.location)).toMatchObject({
      authorizationId:authorization.authorizationId,status:'CONSUMED',tenantId:ids.tenant,consumedAt:now,
    });

    await expect(service.updateState(ids.location, {
      commandId: '01991a00-3000-7000-8000-000000000014', expectedRevision: 99,
      declaredState: 'SUSPENDED', reason: 'OCC rejection test',
    }, actor)).rejects.toBeInstanceOf(LicensingConflictError);
    const suspended = await service.updateState(ids.location, {
      commandId: '01991a00-3000-7000-8000-000000000015', expectedRevision: 1,
      declaredState: 'SUSPENDED', reason: 'security suspension',
    }, actor);
    expect(suspended).toMatchObject({ revision: 2, declaredState: 'SUSPENDED' });
    const retry = await service.updateState(ids.location, {
      commandId: '01991a00-3000-7000-8000-000000000015', expectedRevision: 1,
      declaredState: 'SUSPENDED', reason: 'security suspension',
    }, actor);
    expect(retry.revision).toBe(2);

    const latest = await service.controlState(ids.edge);
    await service.acknowledge(ids.edge, { commandId: '01991a00-3000-7000-8000-000000000016',
      stream: 'LICENSE', revision: latest.license!.revision,
      documentHash: latest.license!.documentHash, appliedAt: now.toISOString() });
    await expect(service.acknowledge(ids.edge, {
      commandId: '01991a00-3000-7000-8000-000000000017', stream: 'LICENSE',
      revision: latest.license!.revision, documentHash: 'f'.repeat(64),
      appliedAt: now.toISOString(),
    })).rejects.toMatchObject({ code: 'CONTROL_ACK_DOCUMENT_MISMATCH' });
    await service.acknowledge(ids.edge, { commandId: '01991a00-3000-7000-8000-000000000016',
      stream: 'LICENSE', revision: latest.license!.revision,
      documentHash: latest.license!.documentHash, appliedAt: now.toISOString() });
    const ackCount = await database.pool.query(`SELECT count(*)::int AS count
      FROM cloud_edge_control_state_acks WHERE edge_id=$1`, [ids.edge]);
    expect(ackCount.rows[0].count).toBe(1);
    const actions = await database.pool.query(`SELECT action FROM cloud_admin_audit_log
      WHERE tenant_id=$1 ORDER BY occurred_at,audit_id`, [ids.tenant]);
    expect(actions.rows.map((row) => row.action)).toContain('LOCATION_LICENSE_STATE_CHANGED');
  });

  async function cleanup() {
    await database.pool.query('DELETE FROM cloud_installation_authorizations WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_edge_control_state_acks WHERE edge_id=$1',[ids.edge]);
    await database.pool.query('DELETE FROM cloud_signed_control_documents WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_location_control_state WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_location_feature_flag_state WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_location_configuration_state WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_location_license_state WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query('DELETE FROM cloud_admin_audit_log WHERE tenant_id=$1 OR actor_admin_user_id=$2',[ids.tenant,ids.user]);
    await database.pool.query('DELETE FROM cloud_admin_audit_chain_heads WHERE scope_key=$1 OR scope_key=$2',[`TENANT:${ids.tenant}`,'PLATFORM']);
    await database.pool.query('DELETE FROM edge_credentials WHERE edge_id=$1',[ids.edge]);
    await database.pool.query('DELETE FROM edges WHERE edge_id=$1',[ids.edge]);
    await database.pool.query('DELETE FROM cloud_locations WHERE location_id=$1',[ids.location]);
    await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1',[ids.tenant]);
    await database.pool.query(`DELETE FROM cloud_plan_entitlements WHERE plan_id IN
      (SELECT plan_id FROM cloud_plans WHERE code='TEST_PLAN')`);
    await database.pool.query(`DELETE FROM cloud_plan_device_limits WHERE plan_id IN
      (SELECT plan_id FROM cloud_plans WHERE code='TEST_PLAN')`);
    await database.pool.query("DELETE FROM cloud_plans WHERE code='TEST_PLAN'");
    await database.pool.query('DELETE FROM cloud_admin_sessions WHERE session_id=$1',[ids.session]);
    await database.pool.query('DELETE FROM cloud_admin_users WHERE user_id=$1',[ids.user]);
  }
});
