import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CashSessionSchema,
  CurrentCashSessionSchema,
  OpenCashSessionRequestSchema,
  type OpenCashSessionRequest,
} from '@comanview/contracts';
import { CashService } from '../application/CashService.js';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';

export function cashRoutes(cashService: CashService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/current',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_VIEW),
        schema: { response: { 200: CurrentCashSessionSchema } },
      },
      async (_request, reply) => reply.send(cashService.getCurrentSession()),
    );

    fastify.post(
      '/',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CASH_SESSION_OPEN),
        schema: {
          body: OpenCashSessionRequestSchema,
          response: { 201: CashSessionSchema, 200: CashSessionSchema },
        },
      },
      async (request, reply) => {
        const session = cashService.openSession(
          request.body as OpenCashSessionRequest,
          operationFrom(request, PERMISSIONS.CASH_SESSION_OPEN),
        );
        reply.status(201).send(session);
      },
    );
  };
}
