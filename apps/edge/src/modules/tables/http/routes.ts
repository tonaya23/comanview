import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { RestaurantTableSchema } from '@comanview/contracts';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import type { TableService } from '../application/TableService.js';

export function tableRoutes(service: TableService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/tables',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_VIEW),
        schema: { response: { 200: RestaurantTableSchema.array() } },
      },
      async (_request, reply) => reply.send(service.list()),
    );
  };
}
