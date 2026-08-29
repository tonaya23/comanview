import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashCloudAdminPassword } from '@comanview/auth';
import type { CloudAdminConfig } from '@comanview/config';
import type {
  CloudAdminSessionRecord,
  CloudAdminUserRecord,
  CloudEdgeRecord,
  CloudReadRepository,
  EdgeReplacementRecord,
  LocationOperationalRecord,
} from '@comanview/database';
import { ControlPlaneConflictError } from '@comanview/database';
import type { CloudRepository } from '../index.js';
import { buildCloudApp } from '../index.js';
import { CloudAdminAuthService, type CloudAdminAuthPersistence } from './CloudAdminAuthService.js';
import type { CloudControlPlaneService } from '../provisioning/CloudControlPlaneService.js';
import type { CloudLicensingService } from '../licensing/CloudLicensingService.js';
import { hashEdgeToken } from '../auth/EdgeAuthenticator.js';
import { SYNC_PROTOCOL_VERSION } from '@comanview/sync';

const tenantId = '01991a00-0000-7000-8000-000000000201';
const foreignTenantId = '01991a00-0000-7000-8000-000000000202';
const locationId = '01991a00-0000-7000-8000-000000000203';
const foreignLocationId = '01991a00-0000-7000-8000-000000000204';
const unprovisionedLocationId = '01991a00-0000-7000-8000-000000000205';

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
    async getLocation(id, scope) {
      if (id === unprovisionedLocationId && (scope.global || scope.tenantIds.includes(tenantId))) {
        return { ...location(), locationId: unprovisionedLocationId, edgeId: null, heartbeatStatus: null,
          lastSeenAt: null, reportedAt: null, edgeVersion: null, schemaVersion: null, pendingEventCount: null };
      }
      return locations.find((item) => item.locationId === id && (scope.global || scope.tenantIds.includes(item.tenantId))) ?? null;
    },
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

async function setup(role: 'PLATFORM_ADMIN' | 'PLATFORM_ADMIN_READ' | 'SUPPORT_READ',
  controlPlane?: CloudControlPlaneService, licensing?: CloudLicensingService,
  repository: CloudRepository = syncRepository) {
  const persistence = new AuthMemory();
  persistence.user = {
    userId: '01991a00-0000-7000-8000-000000000211', email: 'admin@example.test',
    displayName: 'Admin', credentialHash: await hashCloudAdminPassword('valid-password-123'),
    role, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null,
  };
  const auth = new CloudAdminAuthService(persistence, adminConfig, () => now);
  const app = buildCloudApp({ repository,
    admin: { auth, read: readPort(), config: adminConfig, now: () => now },
    ...(controlPlane ? { controlPlane } : {}), ...(licensing ? { licensing } : {}) });
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

  it('returns the structured unprovisioned error when Overview has no ACTIVE Edge', async () => {
    const { app } = await setup('SUPPORT_READ'); const cookie = await login(app);
    const response = await app.inject({ url: `/admin/v1/locations/${unprovisionedLocationId}/overview`, headers: { cookie } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'CLOUD_LOCATION_UNPROVISIONED',
      message: 'Location does not have an ACTIVE Edge yet.',
    });
  });

  it('protects replacement cancellation with RBAC and returns the cancelled record', async () => {
    const record: EdgeReplacementRecord = {
      replacementId: '01991a00-0000-7000-8000-000000000220', tenantId,
      locationId, oldEdgeId: '01991a00-0000-7000-8000-000000000221', newEdgeId: null,
      status: 'CANCELLED', reason: 'Replacement test', initiatedAt: now,
      completedAt: null, cancelledAt: now,
      provisioningCode: {
        provisioningCodeId: '01991a00-0000-7000-8000-000000000222', tenantId, locationId,
        status: 'REVOKED', createdAt: now, expiresAt: new Date(now.getTime() + 60_000),
      },
    };
    const cancelReplacement = vi.fn().mockResolvedValue(record);
    const controlPlane = {
      getReplacement: vi.fn().mockResolvedValue(record),
      getLocation: vi.fn().mockResolvedValue({ tenantId, locationId }),
      cancelReplacement,
    } as unknown as CloudControlPlaneService;
    const payload = { commandId: '01991a00-0000-7000-8000-000000000223', reason: 'Lost one-time code' };

    const restricted = await setup('SUPPORT_READ', controlPlane);
    const restrictedCookie = await login(restricted.app);
    expect((await restricted.app.inject({ method: 'POST', url: `/admin/v1/replacements/${record.replacementId}/cancel`,
      headers: { cookie: restrictedCookie, origin: 'http://localhost:80' }, payload })).statusCode).toBe(403);

    const allowed = await setup('PLATFORM_ADMIN', controlPlane);
    const allowedCookie = await login(allowed.app);
    const response = await allowed.app.inject({ method: 'POST', url: `/admin/v1/replacements/${record.replacementId}/cancel`,
      headers: { cookie: allowedCookie, origin: 'http://localhost:80' }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ replacementId: record.replacementId, status: 'CANCELLED',
      provisioningCode: { status: 'REVOKED' } });
    expect(cancelReplacement).toHaveBeenCalledWith(record.replacementId, payload, expect.any(Object));
  });

  it('protects licensing mutations with RBAC and tenant scope before mutation', async () => {
    const assignment = {
      tenantId, locationId, planId: '01991a00-0000-7000-8000-000000000231',
      planCode: 'TEST_DATA', declaredState: 'ACTIVE' as const, revision: 1,
      capabilities: ['CORE_POS' as const],
      configuration: { payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000] } },
      configurationRevision: 1, featureFlags: {}, featureFlagsRevision: 1,
      desiredControlRevision: 1, activeEdgeId: null, updatedAt: now,
    };
    const assignLocation = vi.fn().mockResolvedValue(assignment);
    const licensing = {
      getAssignmentTenant: vi.fn().mockResolvedValue(tenantId),
      assignLocation,
    } as unknown as CloudLicensingService;
    const payload = {
      commandId: '01991a00-0000-7000-8000-000000000232', expectedRevision: 0,
      planId: assignment.planId, declaredState: 'ACTIVE', configuration: assignment.configuration,
      reason: 'Initial test assignment',
    };

    const restricted = await setup('SUPPORT_READ', undefined, licensing);
    const restrictedCookie = await login(restricted.app);
    expect((await restricted.app.inject({ method: 'PUT',
      url: `/admin/v1/locations/${locationId}/license`,
      headers: { cookie: restrictedCookie, origin: 'http://localhost:80' }, payload })).statusCode)
      .toBe(403);

    const allowed = await setup('PLATFORM_ADMIN', undefined, licensing);
    const allowedCookie = await login(allowed.app);
    const response = await allowed.app.inject({ method: 'PUT',
      url: `/admin/v1/locations/${locationId}/license`,
      headers: { cookie: allowedCookie, origin: 'http://localhost:80' }, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ locationId, planCode: 'TEST_DATA', revision: 1 });
    expect(assignLocation).toHaveBeenCalledTimes(1);
  });

  it('uses the same existing Edge credential for heartbeat, control pull and ACK', async () => {
    const edgeToken = 'licensing-edge-credential-at-least-32-characters';
    const edge: CloudEdgeRecord = {
      edgeId: '01991a00-0000-7000-8000-000000000241', tenantId, locationId,
      credentialHash: hashEdgeToken(edgeToken), status: 'ACTIVE',
    };
    const controlState = vi.fn().mockResolvedValue({
      desiredControlRevision: 3, cloudTime: now.toISOString(),
      license: null, featureFlags: null, configuration: null,
    });
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const desiredRevision = vi.fn().mockResolvedValue(3);
    const licensing = { controlState, acknowledge, desiredRevision } as unknown as CloudLicensingService;
    const saveHeartbeat = vi.fn().mockResolvedValue(undefined);
    const repository: CloudRepository = {
      ...syncRepository, saveHeartbeat,
      async getEdge(id) { return id === edge.edgeId ? edge : null; },
    };
    const { app } = await setup('PLATFORM_ADMIN', undefined, licensing, repository);

    expect((await app.inject({ url: '/edge/v1/control-state' })).statusCode).toBe(401);
    const headers = { 'x-comanview-edge-id': edge.edgeId, authorization: `Bearer ${edgeToken}` };
    expect((await app.inject({ url: '/edge/v1/control-state', headers })).statusCode).toBe(200);
    const heartbeat = await app.inject({ method: 'POST', url: '/sync/v1/heartbeat', headers,
      payload: { protocolVersion: SYNC_PROTOCOL_VERSION, edgeId: edge.edgeId, tenantId,
        locationId, edgeVersion: '0.0.0-test', schemaVersion: '12',
        timestamp: now.toISOString(), status: 'ONLINE', pendingEventCount: 0 } });
    expect(heartbeat.statusCode).toBe(200);
    const ack = await app.inject({ method: 'POST', url: '/edge/v1/control-state/acks', headers,
      payload: { commandId: '01991a00-0000-7000-8000-000000000242', stream: 'LICENSE',
        revision: 1, documentHash: 'a'.repeat(64), appliedAt: now.toISOString() } });
    expect(ack.statusCode).toBe(204);
    expect(controlState).toHaveBeenCalledWith(edge.edgeId);
    expect(acknowledge).toHaveBeenCalledWith(edge.edgeId, expect.any(Object));
    expect(desiredRevision).toHaveBeenCalledWith(edge.edgeId);
    expect(saveHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ edgeId: edge.edgeId }));
  });

  it('returns a stable conflict when revoking an Edge with a pending replacement', async () => {
    const edgeId = '01991a00-0000-7000-8000-000000000224';
    const edge = {
      edgeId, tenantId, locationId, status: 'ACTIVE' as const,
      provisionedAt: now, activatedAt: now, revokedAt: null, replacedAt: null,
      replacedByEdgeId: null,
    };
    const controlPlane = {
      listTenants: vi.fn().mockResolvedValue([{ tenantId }]),
      listLocations: vi.fn().mockResolvedValue([{ locationId }]),
      listEdges: vi.fn().mockResolvedValue([edge]),
      getLocation: vi.fn().mockResolvedValue({ tenantId, locationId }),
      revokeEdge: vi.fn().mockRejectedValue(new ControlPlaneConflictError('EDGE_REPLACEMENT_PENDING')),
    } as unknown as CloudControlPlaneService;
    const { app } = await setup('PLATFORM_ADMIN', controlPlane);
    const cookie = await login(app);
    const response = await app.inject({
      method: 'POST', url: `/admin/v1/edges/${edgeId}/revoke`,
      headers: { cookie, origin: 'http://localhost:80' },
      payload: {
        commandId: '01991a00-0000-7000-8000-000000000225',
        reason: 'Must not revoke during replacement',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'EDGE_REPLACEMENT_PENDING',
      message: 'Cancel the pending Replacement before revoking this Edge.',
    });
  });

  it('revokes logout so the previous cookie returns 401', async () => {
    const { app } = await setup('PLATFORM_ADMIN_READ'); const cookie = await login(app);
    expect((await app.inject({ method: 'POST', url: '/admin/v1/auth/logout', headers: { cookie, origin: 'http://localhost:80' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/admin/v1/locations', headers: { cookie } })).statusCode).toBe(401);
  });
});
