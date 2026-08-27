import {
  generateSessionToken,
  hashSessionToken,
  verifyOperationalPin,
  type Permission,
} from '@comanview/auth';
import type { CurrentSessionResponse, LoginRequest, LoginResponse } from '@comanview/contracts';
import { AuthRepository, type AuthenticatedSessionRecord } from '@comanview/database';
import { EntityId } from '@comanview/domain';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60_000;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tenantId: string,
    private readonly locationId: string,
  ) {}

  async login(request: LoginRequest, now = new Date()): Promise<LoginResponse> {
    const device = this.repository.getDevice(request.deviceId, this.tenantId, this.locationId);
    if (!device || device.status !== 'ACTIVE') {
      throw new AppError('DEVICE_NOT_AUTHORIZED', 401, 'Device is not authorized for this Edge.');
    }

    let attempt = this.repository.getLoginAttempt(device.id);
    if (attempt?.lockedUntil && attempt.lockedUntil.getTime() > now.getTime()) {
      throw new AppError(
        'AUTH_TEMPORARILY_LOCKED',
        429,
        'PIN login is temporarily locked. Try again later.',
      );
    }
    if (attempt?.lockedUntil) {
      this.repository.clearLoginAttempts(device.id);
      attempt = null;
    }

    const users = this.repository.listUsersForLogin(this.tenantId, this.locationId);
    const matches = await Promise.all(
      users.map(async (user) => ({
        user,
        matches: await verifyOperationalPin(request.pin, user.pinHash),
      })),
    );
    const matchedUsers = matches.filter(({ matches: pinMatches }) => pinMatches);
    const matched = matchedUsers.length === 1 ? matchedUsers[0]?.user : null;
    if (!matched || matched.status !== 'ACTIVE') {
      const failedAttempts = (attempt?.failedAttempts ?? 0) + 1;
      this.repository.recordFailedLogin(
        device.id,
        now,
        failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      );
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid operational PIN.');
    }

    this.repository.clearLoginAttempts(device.id);
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + device.sessionTimeoutMinutes * 60_000);
    const sessionId = EntityId.generate().toString();
    this.repository.createSession({
      id: sessionId,
      userId: matched.id,
      deviceId: device.id,
      tenantId: this.tenantId,
      locationId: this.locationId,
      tokenHash: hashSessionToken(token),
      loginAt: now,
      lastActivity: now,
      expiresAt,
    });

    const session = this.repository.findValidSession(hashSessionToken(token), now);
    if (!session) throw new Error('Created auth session could not be loaded.');
    return { token, ...this.toResponse(session) };
  }

  authenticate(token: string, now = new Date()): AuthenticatedActor {
    const session = this.loadValidSession(token, now);
    const expiresAt = new Date(now.getTime() + session.sessionTimeoutMinutes * 60_000);
    this.repository.touchSession(session.sessionId, now, expiresAt);
    return this.toActor(session);
  }

  isTokenAuthorized(token: string, permission: Permission, now = new Date()): boolean {
    try {
      return this.loadValidSession(token, now).permissions.includes(permission);
    } catch {
      return false;
    }
  }

  private loadValidSession(token: string, now: Date): AuthenticatedSessionRecord {
    const session = this.repository.findValidSession(hashSessionToken(token), now);
    if (
      !session ||
      session.userStatus !== 'ACTIVE' ||
      session.deviceStatus !== 'ACTIVE' ||
      session.tenantId !== this.tenantId ||
      session.locationId !== this.locationId ||
      session.userTenantId !== this.tenantId ||
      session.userLocationId !== this.locationId ||
      session.deviceTenantId !== this.tenantId ||
      session.deviceLocationId !== this.locationId
    ) {
      throw new AppError('AUTH_SESSION_INVALID', 401, 'Session is invalid or expired.');
    }
    return session;
  }

  private toActor(session: AuthenticatedSessionRecord): AuthenticatedActor {
    return {
      userId: session.userId,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      tenantId: session.tenantId,
      locationId: session.locationId,
      displayName: session.displayName,
      roles: session.roles,
      permissions: session.permissions,
    };
  }

  current(actor: AuthenticatedActor, now = new Date()): CurrentSessionResponse {
    const session = this.repository.findValidSessionById(actor.sessionId, now);
    if (!session) throw new AppError('AUTH_SESSION_INVALID', 401, 'Session is invalid or expired.');
    return this.toResponse(session);
  }

  logout(actor: AuthenticatedActor, now = new Date()): void {
    this.repository.revokeSession(actor.sessionId, now);
  }

  private toResponse(session: AuthenticatedSessionRecord): CurrentSessionResponse {
    return {
      user: {
        id: session.userId,
        displayName: session.displayName,
        status: 'ACTIVE',
        roles: session.roles,
        permissions: session.permissions,
      },
      session: {
        id: session.sessionId,
        deviceId: session.deviceId,
        loginAt: session.loginAt.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      },
    };
  }
}

export function hasPermission(actor: AuthenticatedActor, permission: Permission): boolean {
  return actor.permissions.includes(permission);
}
