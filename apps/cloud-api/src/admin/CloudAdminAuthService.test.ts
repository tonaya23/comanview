import { beforeEach, describe, expect, it } from 'vitest';
import { hashCloudAdminPassword, hashSessionToken } from '@comanview/auth';
import type { CloudAdminConfig } from '@comanview/config';
import type {
  CloudAdminSessionRecord,
  CloudAdminUserRecord,
} from '@comanview/database';
import {
  CloudAdminAuthService,
  type CloudAdminAuthPersistence,
} from './CloudAdminAuthService.js';

class MemoryAuthPersistence implements CloudAdminAuthPersistence {
  user: CloudAdminUserRecord | null = null;
  sessions = new Map<string, CloudAdminSessionRecord>();
  async findUserByEmail(email: string) { return this.user?.email === email ? this.user : null; }
  async recordFailedLogin(input: { userId: string; maxAttempts: number; lockoutMs: number; now: Date }) {
    if (!this.user || this.user.userId !== input.userId) return;
    this.user.failedLoginCount += 1;
    if (this.user.failedLoginCount >= input.maxAttempts) this.user.lockedUntil = new Date(input.now.getTime() + input.lockoutMs);
  }
  async resetFailedLogin() { if (this.user) { this.user.failedLoginCount = 0; this.user.lockedUntil = null; } }
  async createSession(input: { sessionId: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date }) {
    const user = this.user!;
    this.sessions.set(input.tokenHash, {
      sessionId: input.sessionId, userId: user.userId, email: user.email,
      displayName: user.displayName, role: user.role, userStatus: user.status,
      createdAt: input.createdAt, lastActivityAt: input.createdAt, expiresAt: input.expiresAt,
      revokedAt: null, tenantGrants: ['01991a00-0000-7000-8000-000000000111'],
    });
  }
  async findSessionByTokenHash(hash: string) { return this.sessions.get(hash) ?? null; }
  async touchSession(sessionId: string, now: Date) { for (const session of this.sessions.values()) if (session.sessionId === sessionId) session.lastActivityAt = now; }
  async revokeSession(sessionId: string, now: Date) { for (const session of this.sessions.values()) if (session.sessionId === sessionId) session.revokedAt = now; }
  async provisionDevelopmentAdmin() {}
}

const config: CloudAdminConfig = {
  environment: 'test', sessionTtlMs: 3_600_000, idleTimeoutMs: 600_000,
  maxFailedLoginAttempts: 2, loginLockoutMs: 900_000,
  heartbeatStaleThresholdMs: 90_000, projectionLagThresholdMs: 120_000,
  projectionVersion: 1, secureCookie: false, developmentBootstrap: null,
};

describe('Cloud Admin authentication service', () => {
  let persistence: MemoryAuthPersistence;
  let current: Date;
  let service: CloudAdminAuthService;
  beforeEach(async () => {
    current = new Date('2026-08-28T12:00:00.000Z');
    persistence = new MemoryAuthPersistence();
    persistence.user = {
      userId: '01991a00-0000-7000-8000-000000000121', email: 'admin@example.test',
      displayName: 'Admin Test', credentialHash: await hashCloudAdminPassword('valid-password-123'),
      role: 'PLATFORM_ADMIN_READ', status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null,
    };
    service = new CloudAdminAuthService(persistence, config, () => current);
  });

  it('logs in, restores the opaque session and exposes role permissions/scopes', async () => {
    const login = await service.login('ADMIN@example.test', 'valid-password-123');
    expect(login.token).toHaveLength(43);
    expect(login.principal.permissions).toContain('CLOUD_FINANCIAL_VIEW');
    expect(login.principal.tenantGrants).toHaveLength(1);
    await expect(service.authenticateToken(login.token)).resolves.toMatchObject({ userId: persistence.user!.userId });
    expect([...persistence.sessions.keys()]).toEqual([hashSessionToken(login.token)]);
  });

  it('rejects wrong and inactive credentials without creating a session', async () => {
    await expect(service.login('admin@example.test', 'wrong-password')).rejects.toMatchObject({ statusCode: 401 });
    persistence.user!.status = 'INACTIVE';
    await expect(service.login('admin@example.test', 'valid-password-123')).rejects.toMatchObject({ statusCode: 401 });
    expect(persistence.sessions.size).toBe(0);
  });

  it('persists brute-force lockout and allows login after its expiration', async () => {
    await expect(service.login('admin@example.test', 'wrong-password')).rejects.toBeDefined();
    await expect(service.login('admin@example.test', 'wrong-password')).rejects.toBeDefined();
    await expect(service.login('admin@example.test', 'valid-password-123')).rejects.toMatchObject({ statusCode: 401 });
    current = new Date(current.getTime() + config.loginLockoutMs + 1);
    await expect(service.login('admin@example.test', 'valid-password-123')).resolves.toBeDefined();
  });

  it('rejects absolute expiry, idle expiry and a revoked token', async () => {
    const absolute = await service.login('admin@example.test', 'valid-password-123');
    current = new Date(absolute.principal.session.expiresAt.getTime() + 1);
    await expect(service.authenticateToken(absolute.token)).rejects.toMatchObject({ statusCode: 401 });

    current = new Date('2026-08-28T13:00:00.000Z');
    const idle = await service.login('admin@example.test', 'valid-password-123');
    current = new Date(current.getTime() + config.idleTimeoutMs + 1);
    await expect(service.authenticateToken(idle.token)).rejects.toMatchObject({ statusCode: 401 });

    current = new Date('2026-08-28T14:00:00.000Z');
    const revoked = await service.login('admin@example.test', 'valid-password-123');
    await service.logout(revoked.token);
    await expect(service.authenticateToken(revoked.token)).rejects.toMatchObject({ statusCode: 401 });
  });
});
