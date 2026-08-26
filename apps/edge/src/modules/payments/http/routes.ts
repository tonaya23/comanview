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

export function paymentRoutes(paymentService: PaymentService): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/payments/config',
      { schema: { response: { 200: PaymentConfigSchema } } },
      async (_request, reply) => reply.send(paymentService.getConfig()),
    );

    fastify.post(
      '/orders/:id/payments',
      {
        schema: {
          body: CreatePaymentRequestSchema,
          response: { 200: OrderSchema },
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        reply.send(paymentService.createPayment(id, request.body as CreatePaymentRequest));
      },
    );

    fastify.post(
      '/orders/:id/payments/:paymentId/void',
      {
        schema: {
          body: VoidPaymentRequestSchema,
          response: { 200: OrderSchema },
        },
      },
      async (request, reply) => {
        const { id, paymentId } = request.params as { id: string; paymentId: string };
        reply.send(paymentService.voidPayment(id, paymentId, request.body as VoidPaymentRequest));
      },
    );
  };
}
