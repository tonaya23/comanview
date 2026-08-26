import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CashSessionSchema,
  CurrentCashSessionSchema,
  OpenCashSessionRequestSchema,
  type OpenCashSessionRequest,
} from '@comanview/contracts';
import { CashService } from '../application/CashService.js';

export function cashRoutes(cashService: CashService): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/current',
      { schema: { response: { 200: CurrentCashSessionSchema } } },
      async (_request, reply) => reply.send(cashService.getCurrentSession()),
    );

    fastify.post(
      '/',
      {
        schema: {
          body: OpenCashSessionRequestSchema,
          response: { 201: CashSessionSchema, 200: CashSessionSchema },
        },
      },
      async (request, reply) => {
        const session = cashService.openSession(request.body as OpenCashSessionRequest);
        reply.status(201).send(session);
      },
    );
  };
}
