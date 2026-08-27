import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PrintJobSchema, RequestPrintJobSchema, type RequestPrintJob } from '@comanview/contracts';
import type { PrintService } from '../application/PrintService.js';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';

export function printRoutes(service: PrintService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.post(
      '/orders/:id/precheck',
      {
        preHandler: auth.requirePermission(PERMISSIONS.PRINT_PRECHECK),
        schema: { body: RequestPrintJobSchema, response: { 201: PrintJobSchema } },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply
          .status(201)
          .send(
            service.requestPrecheck(
              id,
              request.body as RequestPrintJob,
              operationFrom(request, PERMISSIONS.PRINT_PRECHECK),
            ),
          );
      },
    );
    fastify.post(
      '/orders/:id/receipt',
      {
        preHandler: auth.requirePermission(PERMISSIONS.PRINT_RECEIPT),
        schema: { body: RequestPrintJobSchema, response: { 201: PrintJobSchema } },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply
          .status(201)
          .send(
            service.requestCustomerReceipt(
              id,
              request.body as RequestPrintJob,
              operationFrom(request, PERMISSIONS.PRINT_RECEIPT),
            ),
          );
      },
    );
    fastify.get(
      '/printing/jobs',
      {
        preHandler: auth.requirePermission(PERMISSIONS.PRINT_JOBS_VIEW),
        schema: { response: { 200: PrintJobSchema.array() } },
      },
      async (_request, reply) => {
        reply.send(service.listRecent());
      },
    );
  };
}
