import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashCloudAdminPassword } from '@comanview/auth';
import type { CloudAdminConfig } from '@comanview/config';
import type {
  CloudAdminSessionRecord,
  CloudAdminUserRecord,
  CloudReadRepository,
  LocationOperationalRecord,
} from '@comanview/database';
import type { CloudRepository } from '../index.js';
import { buildCloudApp } from '../index.js';
import { CloudAdminAuthService, type CloudAdminAuthPersistence } from './CloudAdminAuthService.js';

const tenantId = '01991a00-0000-7000-8000-000000000201';
const foreignTenantId = '01991a00-0000-7000-8000-000000000202';
const locationId = '01991a00-0000-7000-8000-000000000203';
const foreignLocationId = '01991a00-0000-7000-8000-000000000204';

class AuthMemory implements CloudAdminAuthPersistence {
  user!: CloudAdminUserRecord;
  sessions = new Map<string, CloudAdminSessionRecord>();
  async findUserByEmail(email: string) { return this.user.email === email ? this.user : null; }
  async recordFailedLogin() { this.user.failedLoginCount += 1; }
  async resetFailedLogin() { this.user.failedLoginCount = 0; this.user.lockedUntil = null; }
  async createSession(input: { sessionId: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date }) {
    this.sessions.set(input.tokenHash, {
      sessionId: input.sessionId, userId: this.user.userId, email: this.user.email,
      displayName: this.user.displayName, role: this.user.role, userStatus: this.user.status,
      createdAt: input.createdAt, lastActivityAt: input.createdAt, expiresAt: input.expiresAt,
      revokedAt: null, tenantGrants: [tenantId],
    });
  }
  async findSessionByTokenHash(hash: string) { return this.sessions.get(hash) ?? null; }
  async touchSession(sessionId: string, now: Date) { for (const value of this.sessions.values()) if (value.sessionId === sessionId) value.lastActivityAt = now; }
  async revokeSession(sessionId: string, now: Date) { for (const value of this.sessions.values()) if (value.sessionId === sessionId) value.revokedAt = now; }
  async provisionDevelopmentAdmin() {}
}

const now = new Date('2026-08-28T12:00:00.000Z');
const adminConfig: CloudAdminConfig = {
  environment: 'test', sessionTtlMs: 3_600_000, idleTimeoutMs: 900_000,
  maxFailedLoginAttempts: 5, loginLockoutMs: 900_000, heartbeatStaleThresholdMs: 90_000,
  projectionLagThresholdMs: 120_000, projectionVersion: 1, secureCookie: false,
  developmentBootstrap: null,
};
function location(tenant = tenantId, id = locationId): LocationOperationalRecord {
  return {
    tenantId: tenant, locationId: id, edgeId: id.replace(/.$/, '5'), heartbeatStatus: 'ONLINE',
    lastSeenAt: now, reportedAt: now, edgeVersion: '1.0.0', schemaVersion: '12', pendingEventCount: 0,
    activeDeadLetterCount: 0, stalledEventCount: 0, incompleteSaleCount: 0,
    checkpointDegraded: false, lastEventReceivedAt: now, lastProjectionProcessedAt: now,
  };
}

function readPort(): Pick<CloudReadRepository, keyof CloudReadRepository> {
  const locations = [location(), location(foreignTenantId, foreignLocationId)];
  return {
    async listLocations(input) {
      const visible = locations.filter((item) => input.scope.global || input.scope.tenantIds.includes(item.tenantId));
      return { data: visible.slice(0, input.limit), hasMore: false };
    },
    async getLocation(id, scope) { return locations.find((item) => item.locationId === id && (scope.global || scope.tenantIds.includes(item.tenantId))) ?? null; },
    async getOrderCounts() { return { open: 1, closed: 2, cancelled: 0 }; },
    async getCompleteSalesTotals() { return []; }, async countIncompleteSales() { return 0; },
    async listOrders() { return { data: [], hasMore: false }; }, async getOrder() { return null; },
    async listPayments() { return { data: [], hasMore: false }; },
    async listSales() { return { data: [], hasMore: false }; },
    async listCashSessions() { return { data: [], hasMore: false }; },
    async getCurrentOrLatestCashSession() { return null; }, async getCashSession() { return null; },
    async listCashMovements() { return { data: [], hasMore: false }; },
    async getPaymentsForOrder() { return []; }, async getSaleForOrder() { return null; },
  };
}

const syncRepository: CloudRepository = {
  async getEdge() { return null; }, async countInboxEvents() { return 0; },
  async ingestBatch() { return { accepted: [], duplicates: [], integrityRejected: [] }; },
  async saveHeartbeat() {},
};
const apps: ReturnType<typeof buildCloudApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function setup(role: 'PLATFORM_ADMIN_READ' | 'SUPPORT_READ') {
  const persistence = new AuthMemory();
  persistence.user = {
    userId: '01991a00-0000-7000-8000-000000000211', email: 'admin@example.test',
    displayName: 'Admin', credentialHash: await hashCloudAdminPassword('valid-password-123'),
    role, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null,
  };
  const auth = new CloudAdminAuthService(persistence, adminConfig, () => now);
  const app = buildCloudApp({ repository: syncRepository, admin: { auth, read: readPort(), config: adminConfig, now: () => now } });
  apps.push(app);
  return { app };
}

async function login(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST', url: '/admin/v1/auth/login', headers: { origin: 'http://localhost:80' },
    payload: { email: 'admin@example.test', password: 'valid-password-123' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).not.toHaveProperty('token');
  return response.headers['set-cookie']!;
}

describe('Cloud Admin HTTP security', () => {
  it('requires auth, validates same origin and restores a cookie session', async () => {
    const { app } = await setup('PLATFORM_ADMIN_READ');
    expect((await app.inject({ url: '/admin/v1/locations' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/v1/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'admin@example.test', password: 'valid-password-123' } })).statusCode).toBe(403);
    const cookie = await login(app);
    const restored = await app.inject({ url: '/admin/v1/auth/session', headers: { cookie } });
    expect(restored.statusCode).toBe(200);
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
  });

  it('applies tenant grants, returns 404 for foreign scope and validates cursors/limits', async () => {
    const { app } = await setup('SUPPORT_READ');
    const cookie = await login(app);
    const locations = await app.inject({ url: '/admin/v1/locations', headers: { cookie } });
    expect(locations.json().data.map((item: { tenantId: string }) => item.tenantId)).toEqual([tenantId]);
    expect((await app.inject({ url: `/admin/v1/locations/${foreignLocationId}/overview`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/admin/v1/locations/${locationId}/orders?cursor=invalid`, headers: { cookie } })).statusCode).toBe(422);
    expect((await app.inject({ url: `/admin/v1/locations/${locationId}/orders?limit=101`, headers: { cookie } })).statusCode).toBe(422);
  });

  it('allows operational reads but returns 403 for financial reads to SUPPORT_READ', async () => {
    const { app } = await setup('SUPPORT_READ'); const cookie = await login(app);
    expect((await app.inject({ url: `/admin/v1/locations/${locationId}/orders`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/admin/v1/locations/${locationId}/sales`, headers: { cookie } })).statusCode).toBe(403);
  });

  it('revokes logout so the previous cookie returns 401', async () => {
    const { app } = await setup('PLATFORM_ADMIN_READ'); const cookie = await login(app);
    expect((await app.inject({ method: 'POST', url: '/admin/v1/auth/logout', headers: { cookie, origin: 'http://localhost:80' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/admin/v1/locations', headers: { cookie } })).statusCode).toBe(401);
  });
});
