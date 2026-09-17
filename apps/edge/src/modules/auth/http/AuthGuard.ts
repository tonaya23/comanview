import type { FastifyReply, FastifyRequest } from 'fastify';
import { PERMISSIONS, type Permission } from '@comanview/auth';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';
import type { AuthService } from '../application/AuthService.js';
import { defaultOperationalContext } from '../../../app/operationalContext.js';

export type AuthMode = 'enforced' | 'test-bypass';

const TEST_ACTOR: AuthenticatedActor = {
  userId: defaultOperationalContext.operatorId,
  sessionId: '01991a00-0000-7000-8000-000000000799',
  deviceId: '01991a00-0000-7000-8000-000000000721',
  tenantId: defaultOperationalContext.tenantId,
  locationId: defaultOperationalContext.locationId,
  displayName: 'Functional test actor',
  roles: ['OWNER'],
  permissions: Object.values(PERMISSIONS),
};

export class AuthGuard {
  constructor(
    private readonly service: AuthService,
    private readonly mode: AuthMode,
  ) {
    if (mode === 'test-bypass' && process.env['NODE_ENV'] !== 'test') {
      throw new Error('Auth test bypass is only available under NODE_ENV=test.');
    }
  }

  authenticated = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (this.mode === 'test-bypass') {
      request.authContext = TEST_ACTOR;
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new AppError('AUTHENTICATION_REQUIRED', 401, 'A valid local session is required.');
    }
    try {
      request.authContext = await this.service.authenticateHttp(authorization.slice('Bearer '.length));
      if(process.env['COMANVIEW_SECURITY_TRACE']==='true')request.log.info({event:'AUTH_VALIDATED',
        sessionId:request.authContext.sessionId,userId:request.authContext.userId,deviceId:request.authContext.deviceId},'Security trace');
    }catch(error){
      if(process.env['COMANVIEW_SECURITY_TRACE']==='true')request.log.info({event:'AUTH_REJECTED',code:error instanceof AppError?error.code:'UNCLASSIFIED'},'Security trace');
      throw error;
    }
  };

  requirePermission(permission: Permission) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await this.authenticated(request, reply);
      if (!request.authContext?.permissions.includes(permission)) {
        throw new AppError('PERMISSION_DENIED', 403, `Permission ${permission} is required.`);
      }
    };
  }

  get bypassesAuthentication(): boolean {
    return this.mode === 'test-bypass';
  }

  withRealtimeAuthorization(token:string,permissions:readonly Permission[],deliver:(actor:AuthenticatedActor)=>void) {
    if(this.mode==='test-bypass'){deliver(TEST_ACTOR);return Promise.resolve('AUTHORIZED' as const);}
    return this.service.withRealtimeAuthorization(token,permissions,deliver);
  }

  authenticateRealtime(token: string, permission: Permission): boolean {
    if (this.mode === 'test-bypass') return true;
    try {
      return this.service.authenticate(token).permissions.includes(permission);
    } catch {
      return false;
    }
  }

  authenticateRealtimeAny(token: string, permissions: readonly Permission[]): boolean {
    if (this.mode === 'test-bypass') return true;
    try {
      const granted = this.service.authenticate(token).permissions;
      return permissions.some((permission) => granted.includes(permission));
    } catch {
      return false;
    }
  }

  authenticateRealtimeActorAny(
    token: string,
    permissions: readonly Permission[],
  ): AuthenticatedActor | null {
    if (this.mode === 'test-bypass') return TEST_ACTOR;
    try {
      const actor = this.service.authenticate(token);
      return permissions.some((permission) => actor.permissions.includes(permission))
        ? actor
        : null;
    } catch {
      return null;
    }
  }

  isRealtimeSessionValid(token: string, permission: Permission): boolean {
    return this.mode === 'test-bypass' || this.service.isTokenAuthorized(token, permission);
  }

  isRealtimeSessionValidForAny(token: string, permissions: readonly Permission[]): boolean {
    if (this.mode === 'test-bypass') return true;
    return permissions.some((permission) => this.service.isTokenAuthorized(token, permission));
  }
}

export function actorFrom(request: FastifyRequest): AuthenticatedActor {
  if (!request.authContext) {
    throw new AppError('AUTHENTICATION_REQUIRED', 401, 'A valid local session is required.');
  }
  return request.authContext;
}

export function operationFrom(
  request: FastifyRequest,
  permission: Permission,
): AuthorizedOperation {
  return { actor: actorFrom(request), authorizedBy: null, permission, requestedAt: new Date() };
}
