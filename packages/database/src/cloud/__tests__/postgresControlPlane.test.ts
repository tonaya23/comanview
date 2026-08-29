import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createCloudDatabase } from '../db.js';
import { migrateCloudDatabase } from '../migrate.js';
import { CloudControlPlaneRepository, ControlPlaneInvalidCodeError } from '../repositories/CloudControlPlaneRepository.js';
import { CloudSyncRepository } from '../repositories/CloudSyncRepository.js';

const databaseUrl = process.env['COMANVIEW_TEST_POSTGRES_URL'];
const ids = {
  user: '01991a00-1000-7000-8000-000000000001', session: '01991a00-1000-7000-8000-000000000002',
  tenant: '01991a00-1000-7000-8000-000000000003', location: '01991a00-1000-7000-8000-000000000004',
  code: '01991a00-1000-7000-8000-000000000005', codeCommand: '01991a00-1000-7000-8000-000000000006',
  edge: '01991a00-1000-7000-8000-000000000007', credential: '01991a00-1000-7000-8000-000000000008',
  attempt: '01991a00-1000-7000-8000-000000000009', activation: '01991a00-1000-7000-8000-000000000010',
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe.skipIf(!databaseUrl)('Cloud PostgreSQL control plane', () => {
  const database = createCloudDatabase(databaseUrl!); const repository = new CloudControlPlaneRepository(database.pool);
  const syncRepository = new CloudSyncRepository(database.db);
  const actor = { userId: ids.user, sessionId: ids.session }; const now = new Date('2026-08-28T12:00:00.000Z');
  beforeAll(async () => {
    await migrateCloudDatabase(databaseUrl!);
    await database.pool.query('DELETE FROM cloud_admin_audit_log WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM cloud_admin_audit_chain_heads WHERE scope_key=$1', [`TENANT:${ids.tenant}`]);
    await database.pool.query('DELETE FROM edge_replacements WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('UPDATE edges SET provisioning_attempt_id=NULL WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM edge_provisioning_attempts WHERE edge_id IN (SELECT edge_id FROM edges WHERE tenant_id=$1)', [ids.tenant]);
    await database.pool.query('DELETE FROM edge_provisioning_codes WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM edge_credentials WHERE edge_id IN (SELECT edge_id FROM edges WHERE tenant_id=$1)', [ids.tenant]);
    await database.pool.query('DELETE FROM edge_heartbeats WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM cloud_sync_inbox WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM edges WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM cloud_locations WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM cloud_tenants WHERE tenant_id=$1', [ids.tenant]);
    await database.pool.query('DELETE FROM cloud_admin_sessions WHERE session_id=$1', [ids.session]);
    await database.pool.query('DELETE FROM cloud_admin_users WHERE user_id=$1', [ids.user]);
    await database.pool.query(`INSERT INTO cloud_admin_users(user_id,email,display_name,credential_hash,role,status,created_at,updated_at)
      VALUES ($1,'control-plane@test.invalid','Control Plane Test','not-a-secret','PLATFORM_ADMIN','ACTIVE',$2,$2)
      ON CONFLICT(user_id) DO NOTHING`, [ids.user, now]);
    await database.pool.query(`INSERT INTO cloud_admin_sessions(session_id,user_id,token_hash,created_at,last_activity_at,expires_at)
      VALUES ($1,$2,'test-token-hash',$3,$3,$4) ON CONFLICT(session_id) DO NOTHING`, [ids.session, ids.user, now, new Date(now.getTime() + 60_000)]);
  });
  afterAll(async () => { await database.close(); });

  async function seedActiveEdge(input: {
    locationId: string; edgeId: string; credentialId: string; commandId: string;
  }) {
    await repository.createLocation({ tenantId: ids.tenant, locationId: input.locationId,
      displayName: `Fixture ${input.locationId.slice(-3)}`, timezone: 'America/Matamoros',
      commandId: input.commandId, actor, now });
    await database.pool.query(
      `INSERT INTO edges
         (edge_id,tenant_id,location_id,status,created_at,updated_at,provisioned_at,activated_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$4,$4,$4)`,
      [input.edgeId, ids.tenant, input.locationId, now],
    );
    await database.pool.query(
      `INSERT INTO edge_credentials
         (credential_id,edge_id,credential_hash,status,issued_at,activated_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$4)`,
      [input.credentialId, input.edgeId, hash(`fixture-${input.edgeId}`), now],
    );
  }

  it('creates canonical location without Edge, then exchanges idempotently and activates explicitly', async () => {
    const tenant = await repository.createTenant({ tenantId: ids.tenant, displayName: 'Tenant Test', commandId: '01991a00-1000-7000-8000-000000000011', actor, now });
    const location = await repository.createLocation({ tenantId: tenant.tenantId, locationId: ids.location,
      displayName: 'Location Test', timezone: 'America/Matamoros', commandId: '01991a00-1000-7000-8000-000000000012', actor, now });
    expect(await repository.listEdges(location.locationId)).toEqual([]);
    const code = await repository.createProvisioningCode({ provisioningCodeId: ids.code, locationId: ids.location,
      codeHash: hash('provisioning-code-value-32-characters'), expiresAt: new Date(now.getTime() + 1_800_000),
      commandId: ids.codeCommand, actor, now });
    const request = { attemptId: ids.attempt, edgeId: ids.edge, credentialId: ids.credential,
      codeHash: hash('provisioning-code-value-32-characters'), credentialHash: hash('edge-credential-value-at-least-32-chars'), now };
    const first = await repository.exchangeProvisioningCode(request); const retry = await repository.exchangeProvisioningCode(request);
    expect(retry).toEqual(first); expect(first.edge.status).toBe('PROVISIONING'); expect(code.status).toBe('ISSUED');
    const activated = await repository.activateProvisionedEdge({ edgeId: ids.edge, attemptId: ids.attempt,
      credentialId: ids.credential, commandId: ids.activation, now });
    expect(activated.status).toBe('ACTIVE');
    await expect(repository.activateProvisionedEdge({ edgeId: ids.edge, attemptId: ids.attempt,
      credentialId: ids.credential, commandId: ids.activation, now })).resolves.toMatchObject({ status: 'ACTIVE' });
    const persisted = await database.pool.query('SELECT credential_hash,status FROM edges WHERE edge_id=$1', [ids.edge]);
    expect(persisted.rows[0]).toMatchObject({ credential_hash: null, status: 'ACTIVE' });
    const credential = await database.pool.query('SELECT credential_hash,status FROM edge_credentials WHERE credential_id=$1', [ids.credential]);
    expect(credential.rows[0].credential_hash).toBe(hash('edge-credential-value-at-least-32-chars'));
    await expect(database.pool.query(
      `INSERT INTO edges(edge_id,tenant_id,location_id,status,created_at,updated_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$4)`,
      ['01991a00-1000-7000-8000-000000000032', ids.tenant, ids.location, now],
    )).rejects.toMatchObject({ code: '23505' });
    const audit = await database.pool.query('SELECT action,entry_hash FROM cloud_admin_audit_log WHERE tenant_id=$1 ORDER BY occurred_at,audit_id', [ids.tenant]);
    expect(audit.rows.map((row) => row.action)).toContain('EDGE_ACTIVATED'); expect(audit.rows.every((row) => /^[a-f0-9]{64}$/.test(row.entry_hash))).toBe(true);
  });

  it('rejects a consumed provisioning code replay with another attempt', async () => {
    await expect(repository.exchangeProvisioningCode({ attemptId: '01991a00-1000-7000-8000-000000000013',
      edgeId: '01991a00-1000-7000-8000-000000000014', credentialId: '01991a00-1000-7000-8000-000000000015',
      codeHash: hash('provisioning-code-value-32-characters'), credentialHash: hash('another-edge-credential-value-32chars'), now }))
      .rejects.toBeInstanceOf(ControlPlaneInvalidCodeError);
  });

  it('rotates safely and cuts over a replacement only when the new Edge activates', async () => {
    const rotationId = '01991a00-1000-7000-8000-000000000020';
    const rotatedCredentialId = '01991a00-1000-7000-8000-000000000021';
    await repository.registerRotation({ rotationId, credentialId: rotatedCredentialId, edgeId: ids.edge,
      credentialHash: hash('rotated-edge-credential-value-32chars'), now });
    await expect(repository.registerRotation({ rotationId: '01991a00-1000-7000-8000-000000000022',
      credentialId: '01991a00-1000-7000-8000-000000000023', edgeId: ids.edge,
      credentialHash: hash('second-pending-credential-value-32'), now })).rejects.toBeTruthy();
    const rotation = await repository.confirmRotation({ edgeId: ids.edge, rotationId,
      credentialId: rotatedCredentialId, commandId: '01991a00-1000-7000-8000-000000000024',
      overlapMs: 300_000, now });
    expect(rotation).toMatchObject({ status: 'ACTIVE', credentialId: rotatedCredentialId });
    const credentials = await database.pool.query('SELECT status,count(*)::int count FROM edge_credentials WHERE edge_id=$1 GROUP BY status', [ids.edge]);
    expect(Object.fromEntries(credentials.rows.map((row) => [row.status, row.count]))).toMatchObject({ ACTIVE: 1, RETIRING: 1 });
    await syncRepository.getEdge(ids.edge);
    const retired = await database.pool.query('SELECT status,count(*)::int count FROM edge_credentials WHERE edge_id=$1 GROUP BY status', [ids.edge]);
    expect(Object.fromEntries(retired.rows.map((row) => [row.status, row.count]))).toMatchObject({ ACTIVE: 1, REVOKED: 1 });

    const replacement = await repository.initiateReplacement({
      replacementId: '01991a00-1000-7000-8000-000000000025', oldEdgeId: ids.edge,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000026', codeHash: hash('replacement-provision-code-value-32'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Hardware replacement test',
      commandId: '01991a00-1000-7000-8000-000000000027', actor, now,
    });
    const newEdgeId = '01991a00-1000-7000-8000-000000000028';
    const newCredentialId = '01991a00-1000-7000-8000-000000000029';
    const attemptId = '01991a00-1000-7000-8000-000000000030';
    await repository.exchangeProvisioningCode({ attemptId, edgeId: newEdgeId, credentialId: newCredentialId,
      codeHash: hash('replacement-provision-code-value-32'), credentialHash: hash('replacement-edge-credential-value-32'), now });
    await expect(repository.cancelReplacement({
      replacementId: '01991a00-1000-7000-8000-000000000025', reason: 'Cannot cancel after exchange',
      commandId: '01991a00-1000-7000-8000-000000000047', actor, now,
    })).rejects.toMatchObject({ code: 'EDGE_REPLACEMENT_ALREADY_EXCHANGED' });
    expect((await repository.listEdges(ids.location)).filter((edge) => edge.status === 'ACTIVE').map((edge) => edge.edgeId)).toEqual([ids.edge]);
    await repository.activateProvisionedEdge({ edgeId: newEdgeId, attemptId, credentialId: newCredentialId,
      commandId: '01991a00-1000-7000-8000-000000000031', now });
    const edges = await repository.listEdges(ids.location);
    expect(edges.filter((edge) => edge.status === 'ACTIVE').map((edge) => edge.edgeId)).toEqual([newEdgeId]);
    expect(edges.find((edge) => edge.edgeId === ids.edge)?.status).toBe('REPLACED');
    expect(replacement.code.status).toBe('ISSUED');
  });

  it('cancels an unexchanged replacement, preserves the old Edge and permits a new replacement', async () => {
    const activeEdgeId = '01991a00-1000-7000-8000-000000000028';
    const replacementId = '01991a00-1000-7000-8000-000000000033';
    const codeId = '01991a00-1000-7000-8000-000000000034';
    const cancellationTime = new Date(now.getTime() + 1_000);
    await repository.initiateReplacement({
      replacementId, oldEdgeId: activeEdgeId, provisioningCodeId: codeId,
      codeHash: hash('cancelled-replacement-code-value-32'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Replacement to cancel',
      commandId: '01991a00-1000-7000-8000-000000000035', actor, now,
    });
    const cancelled = await repository.cancelReplacement({
      replacementId, reason: 'Provisioning code was lost',
      commandId: '01991a00-1000-7000-8000-000000000037', actor, now: cancellationTime,
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', newEdgeId: null });
    expect(cancelled.provisioningCode.status).toBe('REVOKED');
    expect((await repository.listEdges(ids.location)).find((edge) => edge.edgeId === activeEdgeId)?.status).toBe('ACTIVE');
    await expect(repository.exchangeProvisioningCode({
      attemptId: '01991a00-1000-7000-8000-000000000041',
      edgeId: '01991a00-1000-7000-8000-000000000042',
      credentialId: '01991a00-1000-7000-8000-000000000043',
      codeHash: hash('cancelled-replacement-code-value-32'),
      credentialHash: hash('cancelled-replacement-edge-credential'), now: cancellationTime,
    })).rejects.toBeInstanceOf(ControlPlaneInvalidCodeError);
    const retryReplacement = await repository.initiateReplacement({
      replacementId: '01991a00-1000-7000-8000-000000000038', oldEdgeId: activeEdgeId,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000039',
      codeHash: hash('replacement-after-cancellation-value'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Replacement retry',
      commandId: '01991a00-1000-7000-8000-000000000040', actor, now: cancellationTime,
    });
    expect(retryReplacement).toMatchObject({ replacementId: '01991a00-1000-7000-8000-000000000038' });
    await repository.revokeProvisioningCode({
      codeId: retryReplacement.code.provisioningCodeId,
      commandId: '01991a00-1000-7000-8000-000000000045', actor, now: cancellationTime,
    });
    await expect(repository.cancelReplacement({
      replacementId: retryReplacement.replacementId, reason: 'Replacement code was revoked',
      commandId: '01991a00-1000-7000-8000-000000000046', actor, now: cancellationTime,
    })).resolves.toMatchObject({ status: 'CANCELLED', provisioningCode: { status: 'REVOKED' } });
    const audit = await database.pool.query(
      `SELECT action, reason FROM cloud_admin_audit_log
       WHERE command_id = '01991a00-1000-7000-8000-000000000037'`,
    );
    expect(audit.rows[0]).toEqual({ action: 'EDGE_REPLACEMENT_CANCELLED', reason: 'Provisioning code was lost' });
  });

  it('does not cancel a replacement after cutover', async () => {
    await expect(repository.cancelReplacement({
      replacementId: '01991a00-1000-7000-8000-000000000025', reason: 'Too late to cancel',
      commandId: '01991a00-1000-7000-8000-000000000044', actor, now,
    })).rejects.toMatchObject({ code: 'EDGE_REPLACEMENT_NOT_PENDING' });
  });

  it('rejects revoking an old Edge while its replacement is pending and permits it after cancellation', async () => {
    const locationId = '01991a00-1000-7000-8000-000000000060';
    const activeEdgeId = '01991a00-1000-7000-8000-000000000061';
    await seedActiveEdge({ locationId, edgeId: activeEdgeId,
      credentialId: '01991a00-1000-7000-8000-000000000062',
      commandId: '01991a00-1000-7000-8000-000000000063' });
    const replacementId = '01991a00-1000-7000-8000-000000000064';
    await repository.initiateReplacement({
      replacementId, oldEdgeId: activeEdgeId,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000065',
      codeHash: hash('pending-replacement-revoke-guard'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Revocation guard test',
      commandId: '01991a00-1000-7000-8000-000000000066', actor, now,
    });
    await expect(repository.revokeEdge({ edgeId: activeEdgeId, reason: 'Must be rejected',
      commandId: '01991a00-1000-7000-8000-000000000067', actor, now }))
      .rejects.toMatchObject({ code: 'EDGE_REPLACEMENT_PENDING' });
    expect((await database.pool.query(
      `SELECT count(*)::int AS count FROM cloud_admin_audit_log
       WHERE command_id = '01991a00-1000-7000-8000-000000000067'`,
    )).rows[0]?.count).toBe(0);
    await repository.cancelReplacement({ replacementId, reason: 'Cancel before revocation',
      commandId: '01991a00-1000-7000-8000-000000000068', actor, now });
    await expect(repository.revokeEdge({ edgeId: activeEdgeId, reason: 'Allowed after cancellation',
      commandId: '01991a00-1000-7000-8000-000000000069', actor, now }))
      .resolves.toMatchObject({ status: 'REVOKED' });
  });

  it('serializes a revocation race with replacement cutover', async () => {
    const locationId = '01991a00-1000-7000-8000-000000000070';
    const oldEdgeId = '01991a00-1000-7000-8000-000000000071';
    await seedActiveEdge({ locationId, edgeId: oldEdgeId,
      credentialId: '01991a00-1000-7000-8000-000000000072',
      commandId: '01991a00-1000-7000-8000-000000000073' });
    await repository.initiateReplacement({
      replacementId: '01991a00-1000-7000-8000-000000000074', oldEdgeId,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000075',
      codeHash: hash('replacement-race-code-value-32'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Concurrent cutover test',
      commandId: '01991a00-1000-7000-8000-000000000076', actor, now,
    });
    const newEdgeId = '01991a00-1000-7000-8000-000000000077';
    const credentialId = '01991a00-1000-7000-8000-000000000078';
    const attemptId = '01991a00-1000-7000-8000-000000000079';
    await repository.exchangeProvisioningCode({ attemptId, edgeId: newEdgeId, credentialId,
      codeHash: hash('replacement-race-code-value-32'),
      credentialHash: hash('replacement-race-credential-value'), now });
    const [activation, revocation] = await Promise.allSettled([
      repository.activateProvisionedEdge({ edgeId: newEdgeId, attemptId, credentialId,
        commandId: '01991a00-1000-7000-8000-000000000080', now }),
      repository.revokeEdge({ edgeId: oldEdgeId, reason: 'Concurrent revocation attempt',
        commandId: '01991a00-1000-7000-8000-000000000081', actor, now }),
    ]);
    expect(activation.status).toBe('fulfilled');
    expect(revocation.status).toBe('rejected');
    if (revocation.status === 'rejected') {
      expect(revocation.reason).toMatchObject({ code: expect.stringMatching(/EDGE_(REPLACEMENT_PENDING|ALREADY_REPLACED)/) });
    }
    const edges = await repository.listEdges(locationId);
    expect(edges.find((edge) => edge.edgeId === oldEdgeId)?.status).toBe('REPLACED');
    expect(edges.find((edge) => edge.edgeId === newEdgeId)?.status).toBe('ACTIVE');
    expect(edges.filter((edge) => edge.status === 'ACTIVE')).toHaveLength(1);
  });

  it('rolls back cutover completely when the old Edge is not ACTIVE', async () => {
    const locationId = '01991a00-1000-7000-8000-000000000090';
    const oldEdgeId = '01991a00-1000-7000-8000-000000000091';
    await seedActiveEdge({ locationId, edgeId: oldEdgeId,
      credentialId: '01991a00-1000-7000-8000-000000000092',
      commandId: '01991a00-1000-7000-8000-000000000093' });
    const replacementId = '01991a00-1000-7000-8000-000000000094';
    await repository.initiateReplacement({ replacementId, oldEdgeId,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000095',
      codeHash: hash('replacement-rollback-code-value'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Rollback test',
      commandId: '01991a00-1000-7000-8000-000000000096', actor, now });
    const newEdgeId = '01991a00-1000-7000-8000-000000000097';
    const credentialId = '01991a00-1000-7000-8000-000000000098';
    const attemptId = '01991a00-1000-7000-8000-000000000099';
    await repository.exchangeProvisioningCode({ attemptId, edgeId: newEdgeId, credentialId,
      codeHash: hash('replacement-rollback-code-value'),
      credentialHash: hash('replacement-rollback-credential'), now });
    await database.pool.query(
      `UPDATE edges SET status = 'REVOKED', revoked_at = $2, updated_at = $2 WHERE edge_id = $1`,
      [oldEdgeId, now],
    );
    await expect(repository.activateProvisionedEdge({ edgeId: newEdgeId, attemptId, credentialId,
      commandId: '01991a00-1000-7000-8000-000000000100', now }))
      .rejects.toMatchObject({ code: 'EDGE_REPLACEMENT_OLD_EDGE_NOT_ACTIVE' });
    const state = await database.pool.query(
      `SELECT e.status AS new_edge_status, r.status AS replacement_status,
              a.status AS attempt_status, c.status AS credential_status
       FROM edges e
       JOIN edge_provisioning_attempts a ON a.edge_id = e.edge_id
       JOIN edge_credentials c ON c.credential_id = a.credential_id
       JOIN edge_replacements r ON r.new_edge_id = e.edge_id
       WHERE e.edge_id = $1`,
      [newEdgeId],
    );
    expect(state.rows[0]).toEqual({ new_edge_status: 'PROVISIONING', replacement_status: 'PENDING',
      attempt_status: 'EXCHANGED', credential_status: 'PENDING' });
  });

  it('cancels an orphaned replacement without restoring its revoked old Edge', async () => {
    const locationId = '01991a00-1000-7000-8000-000000000110';
    const oldEdgeId = '01991a00-1000-7000-8000-000000000111';
    await seedActiveEdge({ locationId, edgeId: oldEdgeId,
      credentialId: '01991a00-1000-7000-8000-000000000112',
      commandId: '01991a00-1000-7000-8000-000000000113' });
    const replacementId = '01991a00-1000-7000-8000-000000000114';
    await repository.initiateReplacement({ replacementId, oldEdgeId,
      provisioningCodeId: '01991a00-1000-7000-8000-000000000115',
      codeHash: hash('orphaned-replacement-code-value-32'),
      expiresAt: new Date(now.getTime() + 1_800_000), reason: 'Orphan recovery test',
      commandId: '01991a00-1000-7000-8000-000000000116', actor, now });
    await database.pool.query(
      `UPDATE edges SET status = 'REVOKED', revoked_at = $2, updated_at = $2 WHERE edge_id = $1`,
      [oldEdgeId, now],
    );
    await expect(repository.cancelReplacement({ replacementId, reason: 'Clear orphaned replacement',
      commandId: '01991a00-1000-7000-8000-000000000117', actor, now }))
      .resolves.toMatchObject({ status: 'CANCELLED' });
    expect((await repository.listEdges(locationId)).find((edge) => edge.edgeId === oldEdgeId)?.status).toBe('REVOKED');
  });
});
