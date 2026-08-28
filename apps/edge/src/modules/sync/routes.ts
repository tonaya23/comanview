import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS } from '@comanview/auth';
import { SyncStatusSchema } from '@comanview/sync';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import type { SyncWorker } from './SyncWorker.js';

export function syncRoutes(worker: SyncWorker, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/sync/status',
      {
        preHandler: auth.requirePermission(PERMISSIONS.AUDIT_VIEW),
        schema: { response: { 200: SyncStatusSchema } },
      },
      async (_request, reply) => reply.send(worker.status()),
    );
  };
}
