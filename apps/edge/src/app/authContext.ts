import type { Permission } from '@comanview/auth';

export interface AuthenticatedActor {
  userId: string;
  sessionId: string;
  deviceId: string;
  tenantId: string;
  locationId: string;
  displayName: string;
  roles: string[];
  permissions: Permission[];
}

export interface AuthorizedOperation {
  actor: AuthenticatedActor;
  authorizedBy: {
    userId: string;
    displayName: string;
    roles: string[];
  } | null;
  permission: Permission;
  requestedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthenticatedActor;
  }
}
