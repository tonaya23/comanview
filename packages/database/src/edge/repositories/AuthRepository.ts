import { and, eq, gt, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Permission } from '@comanview/auth';
import * as schema from '../schema.js';

type DB = BetterSQLite3Database<typeof schema>;

export interface LocalUserCredential {
  id: string;
  tenantId: string;
  locationId: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  pinHash: string;
}

export interface LocalDevice {
  id: string;
  tenantId: string;
  locationId: string;
  name: string;
  deviceType: 'POS' | 'WAITER' | 'KDS';
  status: 'ACTIVE' | 'REVOKED';
  sessionTimeoutMinutes: number;
}

export interface AuthenticatedSessionRecord {
  sessionId: string;
  userId: string;
  displayName: string;
  userStatus: 'ACTIVE' | 'DISABLED';
  deviceId: string;
  deviceName: string;
  deviceType: 'POS' | 'WAITER' | 'KDS';
  deviceStatus: 'ACTIVE' | 'REVOKED';
  tenantId: string;
  locationId: string;
  userTenantId: string;
  userLocationId: string;
  deviceTenantId: string;
  deviceLocationId: string;
  loginAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  roles: string[];
  permissions: Permission[];
  sessionTimeoutMinutes: number;
}

export interface NewAuthSession {
  id: string;
  userId: string;
  deviceId: string;
  tenantId: string;
  locationId: string;
  tokenHash: string;
  loginAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export class AuthRepository {
  constructor(private readonly db: DB) {}

  listUsersForLogin(tenantId: string, locationId: string): LocalUserCredential[] {
    return this.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.locationId, locationId)))
      .all() as LocalUserCredential[];
  }

  getDevice(id: string, tenantId: string, locationId: string): LocalDevice | null {
    const row = this.db
      .select()
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.id, id),
          eq(schema.devices.tenantId, tenantId),
          eq(schema.devices.locationId, locationId),
        ),
      )
      .get();
    return (row as LocalDevice | undefined) ?? null;
  }

  createSession(session: NewAuthSession): void {
    this.db.insert(schema.authSessions).values(session).run();
  }

  findValidSession(tokenHash: string, now: Date): AuthenticatedSessionRecord | null {
    return this.findSession(
      and(
        eq(schema.authSessions.tokenHash, tokenHash),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, now),
      ),
    );
  }

  findValidSessionById(sessionId: string, now: Date): AuthenticatedSessionRecord | null {
    return this.findSession(
      and(
        eq(schema.authSessions.id, sessionId),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, now),
      ),
    );
  }

  private findSession(where: ReturnType<typeof and>): AuthenticatedSessionRecord | null {
    const row = this.db
      .select({
        sessionId: schema.authSessions.id,
        userId: schema.users.id,
        displayName: schema.users.displayName,
        userStatus: schema.users.status,
        deviceId: schema.devices.id,
        deviceName: schema.devices.name,
        deviceType: schema.devices.deviceType,
        deviceStatus: schema.devices.status,
        tenantId: schema.authSessions.tenantId,
        locationId: schema.authSessions.locationId,
        userTenantId: schema.users.tenantId,
        userLocationId: schema.users.locationId,
        deviceTenantId: schema.devices.tenantId,
        deviceLocationId: schema.devices.locationId,
        loginAt: schema.authSessions.loginAt,
        lastActivity: schema.authSessions.lastActivity,
        expiresAt: schema.authSessions.expiresAt,
        sessionTimeoutMinutes: schema.devices.sessionTimeoutMinutes,
      })
      .from(schema.authSessions)
      .innerJoin(schema.users, eq(schema.authSessions.userId, schema.users.id))
      .innerJoin(schema.devices, eq(schema.authSessions.deviceId, schema.devices.id))
      .where(where)
      .get();
    if (!row) return null;

    const roleRows = this.db
      .select({ role: schema.roles.name })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .where(eq(schema.userRoles.userId, row.userId))
      .all();
    const permissionRows = this.db
      .select({ permission: schema.rolePermissions.permissionCode })
      .from(schema.userRoles)
      .innerJoin(schema.rolePermissions, eq(schema.userRoles.roleId, schema.rolePermissions.roleId))
      .where(eq(schema.userRoles.userId, row.userId))
      .all();

    return {
      ...row,
      userStatus: row.userStatus as 'ACTIVE' | 'DISABLED',
      deviceType: row.deviceType as 'POS' | 'WAITER' | 'KDS',
      deviceStatus: row.deviceStatus as 'ACTIVE' | 'REVOKED',
      roles: roleRows.map(({ role }) => role),
      permissions: [...new Set(permissionRows.map(({ permission }) => permission as Permission))],
    };
  }

  touchSession(sessionId: string, lastActivity: Date, expiresAt: Date): void {
    this.db
      .update(schema.authSessions)
      .set({ lastActivity, expiresAt })
      .where(eq(schema.authSessions.id, sessionId))
      .run();
  }

  revokeSession(sessionId: string, revokedAt: Date): void {
    this.db
      .update(schema.authSessions)
      .set({ revokedAt })
      .where(eq(schema.authSessions.id, sessionId))
      .run();
  }

  getLoginAttempt(deviceId: string): { failedAttempts: number; lockedUntil: Date | null } | null {
    const row = this.db
      .select({
        failedAttempts: schema.loginAttempts.failedAttempts,
        lockedUntil: schema.loginAttempts.lockedUntil,
      })
      .from(schema.loginAttempts)
      .where(eq(schema.loginAttempts.deviceId, deviceId))
      .get();
    return row ?? null;
  }

  recordFailedLogin(deviceId: string, now: Date, lockedUntil: Date | null): void {
    const current = this.getLoginAttempt(deviceId);
    this.db
      .insert(schema.loginAttempts)
      .values({
        deviceId,
        failedAttempts: (current?.failedAttempts ?? 0) + 1,
        lockedUntil,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.loginAttempts.deviceId,
        set: {
          failedAttempts: (current?.failedAttempts ?? 0) + 1,
          lockedUntil,
          updatedAt: now,
        },
      })
      .run();
  }

  clearLoginAttempts(deviceId: string): void {
    this.db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.deviceId, deviceId)).run();
  }
}
