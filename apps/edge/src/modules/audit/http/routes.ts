import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AuditListQuerySchema, AuditListResponseSchema } from '@comanview/contracts';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { actorFrom } from '../../auth/http/AuthGuard.js';
import type { AuditService } from '../application/AuditService.js';

export function auditRoutes(service: AuditService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/audit',
      {
        preHandler: auth.requirePermission(PERMISSIONS.AUDIT_VIEW),
        schema: {
          querystring: AuditListQuerySchema,
          response: { 200: AuditListResponseSchema },
        },
      },
      async (request, reply) => reply.send(service.list(request.query, actorFrom(request))),
    );
  };
}
