import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashCloudAdminPassword, hashSessionToken } from '@comanview/auth';
import { createCloudDatabase } from '../db.js';
import { migrateCloudDatabase } from '../migrate.js';
import { CloudAdminAuthRepository } from '../repositories/CloudAdminAuthRepository.js';
import { CloudReadRepository } from '../repositories/CloudReadRepository.js';

const databaseUrl = process.env['COMANVIEW_TEST_POSTGRES_URL'];

describe.skipIf(!databaseUrl)('Cloud Admin Read repositories with PostgreSQL', () => {
  const database = createCloudDatabase(databaseUrl!);
  const auth = new CloudAdminAuthRepository(database.pool);
  const read = new CloudReadRepository(database.pool, 1);
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const locationA = randomUUID(); const locationB = randomUUID();
  const edgeA = randomUUID(); const edgeB = randomUUID();
  const userId = randomUUID(); const orderIds = [randomUUID(), randomUUID()];
  const eventIds = [randomUUID(), randomUUID()];
  const usdOrderId = randomUUID(); const usdEventId = randomUUID();
  const now = new Date('2026-08-28T12:00:00.000Z');

  beforeAll(async () => {
    await migrateCloudDatabase(databaseUrl!);
    await database.pool.query(
      `INSERT INTO edges (edge_id, tenant_id, location_id, credential_hash, status)
       VALUES ($1,$2,$3,'hash','ACTIVE'),($4,$5,$6,'hash','ACTIVE')`,
      [edgeA, tenantA, locationA, edgeB, tenantB, locationB],
    );
    await database.pool.query(
      `INSERT INTO edge_heartbeats
       (edge_id,tenant_id,location_id,last_seen_at,edge_version,schema_version,pending_event_count,status,reported_at)
       VALUES ($1,$2,$3,$4,'1.0.0','12',0,'ONLINE',$4),($5,$6,$7,$4,'1.0.0','12',0,'ONLINE',$4)`,
      [edgeA, tenantA, locationA, now, edgeB, tenantB, locationB],
    );
    for (let index = 0; index < 2; index += 1) {
      await database.pool.query(
        `INSERT INTO cloud_order_operational_summaries
         (projection_version,order_id,tenant_id,location_id,edge_id,order_type,order_channel,status,
          table_ids,item_count,sent_item_count,paid_amount,tip_amount,currency,created_at,last_event_id,
          last_local_sequence,updated_at)
         VALUES (1,$1,$2,$3,$4,'COUNTER','POS','CLOSED','[]',1,1,4500,500,'MXN',$5,$6,$7,$5)`,
        [orderIds[index]!, tenantA, locationA, edgeA, new Date(now.getTime() - index * 1000), eventIds[index]!, index + 1],
      );
    }
    await database.pool.query(
      `INSERT INTO cloud_closed_sale_summaries
       (projection_version,order_id,tenant_id,location_id,edge_id,sale_amount,tip_amount,charged_total,
        currency,completeness_status,closed_at,source_event_id,last_local_sequence)
       VALUES (1,$1,$2,$3,$4,4500,500,5000,'MXN','COMPLETE',$5,$6,1),
              (1,$7,$2,$3,$4,9999,999,10998,'MXN','INCOMPLETE',$5,$8,2),
              (1,$9,$2,$3,$4,2000,0,2000,'USD','COMPLETE',$5,$10,3)`,
      [orderIds[0], tenantA, locationA, edgeA, now, eventIds[0], orderIds[1], eventIds[1], usdOrderId, usdEventId],
    );
    await auth.provisionDevelopmentAdmin({
      userId, email: 'postgres-admin@example.test', displayName: 'Postgres Admin',
      credentialHash: await hashCloudAdminPassword('database-password-123'),
      role: 'SUPPORT_READ', tenantIds: [tenantA], now,
    });
  });

  afterAll(async () => {
    await database.pool.query('DELETE FROM cloud_admin_sessions WHERE user_id = $1', [userId]);
    await database.pool.query('DELETE FROM cloud_admin_tenant_grants WHERE user_id = $1', [userId]);
    await database.pool.query('DELETE FROM cloud_admin_users WHERE user_id = $1', [userId]);
    await database.pool.query('DELETE FROM cloud_closed_sale_summaries WHERE edge_id = ANY($1::uuid[])', [[edgeA, edgeB]]);
    await database.pool.query('DELETE FROM cloud_order_operational_summaries WHERE edge_id = ANY($1::uuid[])', [[edgeA, edgeB]]);
    await database.pool.query('DELETE FROM edge_heartbeats WHERE edge_id = ANY($1::uuid[])', [[edgeA, edgeB]]);
    await database.pool.query('DELETE FROM edges WHERE edge_id = ANY($1::uuid[])', [[edgeA, edgeB]]);
    await database.close();
  });

  it('applies 0002, stores password/session hashes only and persists tenant grants', async () => {
    const migration = await database.pool.query(
      `SELECT migration_name FROM cloud_schema_migrations WHERE migration_name = '0002_cloud_admin_read_api.sql'`,
    );
    expect(migration.rowCount).toBe(1);
    const user = await auth.findUserByEmail('POSTGRES-ADMIN@example.test');
    expect(user?.credentialHash).not.toContain('database-password-123');
    const rawToken = 'opaque-cloud-admin-session-token-for-postgres-test';
    await auth.createSession({ sessionId: randomUUID(), userId, tokenHash: hashSessionToken(rawToken), createdAt: now, expiresAt: new Date(now.getTime() + 60_000) });
    const stored = await database.pool.query('SELECT token_hash FROM cloud_admin_sessions WHERE user_id = $1', [userId]);
    expect(stored.rows[0]?.token_hash).toBe(hashSessionToken(rawToken));
    expect(stored.rows[0]?.token_hash).not.toBe(rawToken);
    expect((await auth.findSessionByTokenHash(hashSessionToken(rawToken)))?.tenantGrants).toEqual([tenantA]);
  });

  it('scopes locations/resources by tenant and never returns a foreign location', async () => {
    const scope = { global: false, tenantIds: [tenantA] };
    const locations = await read.listLocations({ scope, limit: 50, lagCutoff: new Date(now.getTime() - 120_000) });
    expect(locations.data.map((item) => item.locationId)).toEqual([locationA]);
    await expect(read.getLocation(locationB, scope, now)).resolves.toBeNull();
    await expect(read.getOrder({ tenantId: tenantB, locationId: locationB, edgeId: edgeB }, orderIds[0]!)).resolves.toBeNull();
  });

  it('uses deterministic keyset order and excludes INCOMPLETE sales from trusted totals', async () => {
    const location = { tenantId: tenantA, locationId: locationA, edgeId: edgeA };
    const first = await read.listOrders({ location, limit: 1 });
    expect(first.data).toHaveLength(1); expect(first.hasMore).toBe(true);
    const second = await read.listOrders({
      location, limit: 1,
      cursor: { timestamp: first.data[0]!.createdAt, id: first.data[0]!.orderId },
    });
    expect(second.data[0]!.orderId).not.toBe(first.data[0]!.orderId);
    expect(await read.getCompleteSalesTotals(location, new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000))).toEqual([
      { currency: 'MXN', saleAmount: 4500, tipAmount: 500, chargedTotal: 5000 },
      { currency: 'USD', saleAmount: 2000, tipAmount: 0, chargedTotal: 2000 },
    ]);
    expect(await read.countIncompleteSales(location, new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000))).toBe(1);
  });
});
