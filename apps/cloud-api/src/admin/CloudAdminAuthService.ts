import {
  CLOUD_PERMISSIONS,
  CLOUD_ROLE_PERMISSIONS,
  generateSessionToken,
  hashCloudAdminPassword,
  hashSessionToken,
  verifyCloudAdminPassword,
  type CloudAdminRole,
  type CloudPermission,
} from '@comanview/auth';
import { EntityId } from '@comanview/domain';
import type { CloudAdminAuthRepository } from '@comanview/database';
import type { CloudAdminConfig } from '@comanview/config';
import { CloudError } from '../app/CloudError.js';

export interface CloudAdminPrincipal {
  userId: string;
  email: string;
  displayName: string;
  role: CloudAdminRole;
  permissions: readonly CloudPermission[];
  tenantGrants: string[];
  session: {
    id: string;
    createdAt: Date;
    lastActivityAt: Date;
    expiresAt: Date;
  };
}

export type CloudAdminAuthPersistence = Pick<
  CloudAdminAuthRepository,
  keyof CloudAdminAuthRepository
>;

export class CloudAdminAuthService {
  private readonly dummyPasswordHash = hashCloudAdminPassword(
    'comanview-cloud-auth-nonexistent-user-verification-value',
  );

  constructor(
    private readonly repository: CloudAdminAuthPersistence,
    private readonly config: CloudAdminConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(email: string, password: string): Promise<{
    token: string;
    principal: CloudAdminPrincipal;
  }> {
    const now = this.now();
    const user = await this.repository.findUserByEmail(email.trim().toLowerCase());
    const hash = user?.credentialHash ?? (await this.dummyPasswordHash);
    const validPassword = await verifyCloudAdminPassword(password, hash);
    const locked = Boolean(user?.lockedUntil && user.lockedUntil > now);
    if (!user || !validPassword || user.status !== 'ACTIVE' || locked) {
      if (user && user.status === 'ACTIVE' && !locked) {
        await this.repository.recordFailedLogin({
          userId: user.userId,
          maxAttempts: this.config.maxFailedLoginAttempts,
          lockoutMs: this.config.loginLockoutMs,
          now,
        });
      }
      throw new CloudError(
        'CLOUD_ADMIN_AUTH_INVALID',
        401,
        'Cloud Admin credentials are invalid or temporarily locked.',
      );
    }
    await this.repository.resetFailedLogin(user.userId, now);
    const token = generateSessionToken();
    const sessionId = EntityId.generate().toString();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);
    await this.repository.createSession({
      sessionId,
      userId: user.userId,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt,
    });
    const principal = await this.authenticateToken(token);
    return { token, principal };
  }

  async authenticateToken(token: string | null): Promise<CloudAdminPrincipal> {
    if (!token) throw unauthorized();
    const record = await this.repository.findSessionByTokenHash(hashSessionToken(token));
    const now = this.now();
    if (
      !record ||
      record.revokedAt ||
      record.userStatus !== 'ACTIVE' ||
      record.expiresAt <= now ||
      now.getTime() - record.lastActivityAt.getTime() > this.config.idleTimeoutMs
    ) {
      if (record && !record.revokedAt) await this.repository.revokeSession(record.sessionId, now);
      throw unauthorized();
    }
    await this.repository.touchSession(record.sessionId, now);
    const permissions = CLOUD_ROLE_PERMISSIONS[record.role];
    if (!permissions) throw unauthorized();
    return {
      userId: record.userId,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      permissions,
      tenantGrants: record.tenantGrants,
      session: {
        id: record.sessionId,
        createdAt: record.createdAt,
        lastActivityAt: now,
        expiresAt: record.expiresAt,
      },
    };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) throw unauthorized();
    const record = await this.repository.findSessionByTokenHash(hashSessionToken(token));
    if (!record || record.revokedAt) throw unauthorized();
    await this.repository.revokeSession(record.sessionId, this.now());
  }

  async provisionDevelopmentAdmin(): Promise<void> {
    const bootstrap = this.config.developmentBootstrap;
    if (!bootstrap) return;
    if (this.config.environment === 'production') {
      throw new Error('Development Cloud Admin bootstrap is forbidden in production.');
    }
    await this.repository.provisionDevelopmentAdmin({
      userId: EntityId.generate().toString(),
      email: bootstrap.email,
      displayName: bootstrap.displayName,
      credentialHash: await hashCloudAdminPassword(bootstrap.password),
      role: bootstrap.role,
      tenantIds: bootstrap.tenantIds,
      now: this.now(),
    });
  }
}

export function requireCloudPermission(
  principal: CloudAdminPrincipal,
  permission: CloudPermission,
): void {
  if (!principal.permissions.includes(permission)) {
    throw new CloudError('CLOUD_ADMIN_FORBIDDEN', 403, 'Cloud Admin permission is required.');
  }
}

export function accessScope(principal: CloudAdminPrincipal) {
  return {
    global: principal.permissions.includes(CLOUD_PERMISSIONS.CLOUD_TENANT_READ_ALL),
    tenantIds: principal.tenantGrants,
  };
}

function unauthorized(): CloudError {
  return new CloudError('CLOUD_ADMIN_AUTH_REQUIRED', 401, 'Cloud Admin authentication is required.');
}
