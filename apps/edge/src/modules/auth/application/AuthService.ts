import {
  generateSessionToken,
  hashSessionToken,
  verifyOperationalPin,
  verifyDeviceCredential,
  type Permission,
} from '@comanview/auth';
import type { CurrentSessionResponse, LoginRequest, LoginResponse } from '@comanview/contracts';
import { AuthRepository, type AuthenticatedSessionRecord } from '@comanview/database';
import { EntityId } from '@comanview/domain';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';
import { isDeviceRevokedByFloor, type RecoverySecurityStore } from '../../backup/RecoverySecurityStore.js';
import { personnelRestrictions, personnelSessionIsCurrent } from '../../personnel/PersonnelSecurityModel.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60_000;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tenantId: string,
    private readonly locationId: string,
    private readonly securityStore?: RecoverySecurityStore,
  ) {}

  async login(request: LoginRequest, now = new Date()): Promise<LoginResponse> {
    const device = this.repository.getDevice(request.deviceId, this.tenantId, this.locationId);
    if (!device) throw new AppError('DEVICE_NOT_PAIRED', 401, 'Device is not paired with this Edge.');
    if (device.status === 'REVOKED') throw new AppError('DEVICE_REVOKED', 401, 'Device authorization was revoked.');
    if (device.status !== 'ACTIVE') throw new AppError('DEVICE_NOT_AUTHORIZED', 401, 'Device is not active.');
    if (!device.credentialHash || !verifyDeviceCredential(request.deviceCredential, device.credentialHash))
      throw new AppError('DEVICE_CREDENTIAL_INVALID', 401, 'Device credential is invalid.');

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
    if (matched?.status === 'DISABLED') {
      throw new AppError('USER_DISABLED', 401, 'User is disabled.');
    }
    if (!matched) {
      const failedAttempts = (attempt?.failedAttempts ?? 0) + 1;
      this.repository.recordFailedLogin(
        device.id,
        now,
        failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      );
      throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid operational PIN.');
    }

    await this.securityStore?.load();
    const fresh=this.repository.listUsersForLogin(this.tenantId,this.locationId).find(user=>user.id===matched.id);
    if(!fresh||fresh.pinHash!==matched.pinHash||fresh.status!=='ACTIVE')throw new AppError('INVALID_CREDENTIALS',401,'Credentials changed during authentication.');
    this.assertPersonnelUser(matched.id);
    const floor=this.securityStore?.licensingSnapshot?.();
    if(floor&&isDeviceRevokedByFloor(floor,device.id))throw new AppError('DEVICE_REVOKED',401,'Device authorization was revoked.');

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
      ...(floor?.personnel?{security:{trustDomainId:floor.personnel.trustDomainId,
        credentialRevision:floor.personnel.users[matched.id]!.credentialRevision,
        authorizationRevision:floor.personnel.users[matched.id]!.authorizationRevision,
        sessionRevision:floor.personnel.users[matched.id]!.sessionRevision,issuedRecoveryEpoch:floor.recoveryEpoch}}:{}),
    });

    const session = this.repository.findValidSession(hashSessionToken(token), now);
    if (!session) throw new Error('Created auth session could not be loaded.');
    this.assertPersonnelSession(session);
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
    this.assertPersonnelSession(session);
    return session;
  }

  private assertPersonnelUser(userId:string):void{
    if(this.securityStore&&!this.securityStore.licensingSnapshot?.())
      throw new AppError('PERSONNEL_SECURITY_UNAVAILABLE',401,'Personnel security must be refreshed.');
    if(!this.repository.personnelSchemaPresent()){
      if(this.securityStore?.licensingSnapshot?.()?.personnel)throw new AppError('USER_UNTRUSTED',401,'Legacy personnel requires review.');
      return;
    }
    const floor=this.securityStore?.licensingSnapshot?.(),row=this.repository.getPersonnelUserSecurity(userId);
    if(!floor?.personnel||!row||floor.recoveryState!=='NORMAL'||floor.administrationUpgradeJournal)
      throw new AppError('PERSONNEL_SECURITY_NOT_INITIALIZED',401,'Personnel security is unavailable.');
    const restrictions=personnelRestrictions(floor.personnel,row);
    if(restrictions.length)throw new AppError(restrictions[0]!,401,'Personnel security requires review.');
  }
  private assertPersonnelSession(session:AuthenticatedSessionRecord):void{
    this.assertPersonnelUser(session.userId);
    if(!this.repository.personnelSchemaPresent())return;
    const floor=this.securityStore?.licensingSnapshot?.(),row=this.repository.getPersonnelUserSecurity(session.userId),
      issued=this.repository.getPersonnelSessionSecurity(session.sessionId);
    if(!floor?.personnel||!row||!issued||isDeviceRevokedByFloor(floor,session.deviceId)||
      !personnelSessionIsCurrent(floor.personnel,row,issued,floor.recoveryEpoch))
      throw new AppError('AUTH_SESSION_INVALID',401,'Session security is outdated.');
  }
  private currentActor(actor:AuthenticatedActor,now:Date):AuthenticatedSessionRecord{
    const session=this.repository.findValidSessionById(actor.sessionId,now);
    if(!session||session.userId!==actor.userId||session.deviceId!==actor.deviceId||session.userStatus!=='ACTIVE'||
      session.deviceStatus!=='ACTIVE'||session.tenantId!==this.tenantId||session.locationId!==this.locationId||
      session.userTenantId!==this.tenantId||session.userLocationId!==this.locationId||
      session.deviceTenantId!==this.tenantId||session.deviceLocationId!==this.locationId)
      throw new AppError('AUTH_SESSION_INVALID',401,'Session is invalid or expired.');
    this.assertPersonnelSession(session);return session;
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
    const session = this.currentActor(actor,now);
    return this.toResponse(session);
  }

  logout(actor: AuthenticatedActor, now = new Date()): void {
    this.repository.revokeSession(actor.sessionId, now);
  }

  async authorizeSingleOperation(
    actor: AuthenticatedActor,
    permission: Permission,
    overridePin: string | undefined,
    now = new Date(),
  ): Promise<AuthorizedOperation> {
    if (this.currentActor(actor,now).permissions.includes(permission)) {
      return { actor, authorizedBy: null, permission, requestedAt: now };
    }
    if (!overridePin) {
      throw new AppError(
        'OVERRIDE_REQUIRED',
        403,
        'Additional authorization is required for this operation.',
      );
    }

    const candidates = this.repository.listUsersForLogin(this.tenantId, this.locationId);
    const matches = await Promise.all(
      candidates.map(async (user) => ({
        user,
        matches: await verifyOperationalPin(overridePin, user.pinHash),
      })),
    );
    const matchedUsers = matches.filter(({ matches: pinMatches }) => pinMatches);
    const matched = matchedUsers.length === 1 ? matchedUsers[0]?.user : null;
    if (!matched) {
      throw new AppError('OVERRIDE_PIN_INVALID', 403, 'Override authorization was rejected.');
    }
    if (matched.status !== 'ACTIVE') {
      throw new AppError('OVERRIDE_USER_INACTIVE', 403, 'Override authorization was rejected.');
    }

    await this.securityStore?.load();
    this.currentActor(actor,new Date());
    this.assertPersonnelUser(matched.id);
    const fresh=this.repository.listUsersForLogin(this.tenantId,this.locationId).find(user=>user.id===matched.id);
    if(!fresh||fresh.status!=='ACTIVE'||fresh.pinHash!==matched.pinHash)throw new AppError('OVERRIDE_USER_INACTIVE',403,'Override authorization changed.');

    const authorizer = this.repository.getUserAuthorization(matched);
    if (!authorizer.permissions.includes(permission)) {
      throw new AppError(
        'OVERRIDE_PERMISSION_DENIED',
        403,
        'Override authorization was rejected.',
      );
    }
    return {
      actor,
      authorizedBy: {
        userId: authorizer.id,
        displayName: authorizer.displayName,
        roles: authorizer.roles,
      },
      permission,
      requestedAt: now,
    };
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
