import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PrintJobSchema, RequestPrintJobSchema, type RequestPrintJob } from '@comanview/contracts';
import type { PrintService } from '../application/PrintService.js';

export function printRoutes(service: PrintService): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.post(
      '/orders/:id/precheck',
      { schema: { body: RequestPrintJobSchema, response: { 201: PrintJobSchema } } },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply.status(201).send(service.requestPrecheck(id, request.body as RequestPrintJob));
      },
    );
    fastify.post(
      '/orders/:id/receipt',
      { schema: { body: RequestPrintJobSchema, response: { 201: PrintJobSchema } } },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply.status(201).send(service.requestCustomerReceipt(id, request.body as RequestPrintJob));
      },
    );
    fastify.get(
      '/printing/jobs',
      { schema: { response: { 200: PrintJobSchema.array() } } },
      async (_request, reply) => {
        reply.send(service.listRecent());
      },
    );
  };
}
