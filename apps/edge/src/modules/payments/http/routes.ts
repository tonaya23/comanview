import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreatePaymentRequestSchema,
  OrderSchema,
  PaymentConfigSchema,
  VoidPaymentRequestSchema,
  type CreatePaymentRequest,
  type VoidPaymentRequest,
} from '@comanview/contracts';
import { PaymentService } from '../application/PaymentService.js';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';
import { actorFrom } from '../../auth/http/AuthGuard.js';
import type { AuthService } from '../../auth/application/AuthService.js';

export function paymentRoutes(
  paymentService: PaymentService,
  auth: AuthGuard,
  authService: AuthService,
): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/payments/config',
      {
        preHandler: auth.requirePermission(PERMISSIONS.PAYMENT_CONFIG_VIEW),
        schema: { response: { 200: PaymentConfigSchema } },
      },
      async (_request, reply) => reply.send(paymentService.getConfig()),
    );

    fastify.post(
      '/orders/:id/payments',
      {
        preHandler: auth.requirePermission(PERMISSIONS.PAYMENT_CREATE),
        schema: {
          body: CreatePaymentRequestSchema,
          response: { 200: OrderSchema },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply.send(
          paymentService.createPayment(
            id,
            request.body as CreatePaymentRequest,
            operationFrom(request, PERMISSIONS.PAYMENT_CREATE),
          ),
        );
      },
    );

    fastify.post(
      '/orders/:id/payments/:paymentId/void',
      {
        preHandler: auth.authenticated,
        schema: {
          body: VoidPaymentRequestSchema,
          response: { 200: OrderSchema },
        },
      },
      async (request, reply) => {
        const { id, paymentId } = request.params as { id: string; paymentId: string };
        const body = request.body as VoidPaymentRequest;
        const operation = await authService.authorizeSingleOperation(
          actorFrom(request),
          PERMISSIONS.PAYMENT_VOID,
          body.overridePin,
        );
        reply.send(
          paymentService.voidPayment(
            id,
            paymentId,
            body,
            operation,
          ),
        );
      },
    );
  };
}
