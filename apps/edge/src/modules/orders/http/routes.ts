import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { OrderService } from '../application/OrderService.js';
import {
  CreateOrderRequestSchema,
  AddOrderItemRequestSchema,
  SendRoundRequestSchema,
  CloseOrderRequestSchema,
  CancelOrderRequestSchema,
  RemoveOrderItemRequestSchema,
  CreateOrderRequest,
  AddOrderItemRequest,
  SendRoundRequest,
  CloseOrderRequest,
  CancelOrderRequest,
  RemoveOrderItemRequest,
  UpdateOrderTablesRequestSchema,
  UpdateOrderTablesRequest,
  UpdateOrderItemSpecialInstructionsRequestSchema,
  UpdateOrderItemSpecialInstructionsRequest,
} from '@comanview/contracts';

export function orderRoutes(orderService: OrderService): FastifyPluginAsyncZod {
  return async (fastify) => {
    // POST /orders
    fastify.post(
      '/',
      {
        schema: {
          body: CreateOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const body = request.body as CreateOrderRequest;
        const order = await orderService.createOrder(body);
        reply.status(201).send(order);
      },
    );

    // PATCH /orders/:id/items/:itemId/instructions
    fastify.patch(
      '/:id/items/:itemId/instructions',
      {
        schema: {
          body: UpdateOrderItemSpecialInstructionsRequestSchema,
        },
      },
      async (request, reply) => {
        const { id, itemId } = request.params as { id: string; itemId: string };
        const body = request.body as UpdateOrderItemSpecialInstructionsRequest;
        const order = await orderService.updateItemSpecialInstructions(id, itemId, body);
        reply.send(order);
      },
    );

    // GET /orders/:id
    fastify.get('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const order = await orderService.getOrder(id);

      if (!order) {
        reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
        return;
      }

      reply.send(order);
    });

    // POST /orders/:id/items
    fastify.post(
      '/:id/items',
      {
        schema: {
          body: AddOrderItemRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as AddOrderItemRequest;
        const order = await orderService.addItem(id, body);
        reply.send(order);
      },
    );

    // DELETE /orders/:id/items/:itemId
    fastify.delete(
      '/:id/items/:itemId',
      {
        schema: {
          body: RemoveOrderItemRequestSchema,
        },
      },
      async (request, reply) => {
        const { id, itemId } = request.params as { id: string; itemId: string };
        const body = request.body as RemoveOrderItemRequest;
        const order = await orderService.removeItem(id, itemId, body);
        reply.send(order);
      },
    );

    // POST /orders/:id/rounds
    fastify.post(
      '/:id/rounds',
      {
        schema: {
          body: SendRoundRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as SendRoundRequest;
        const order = await orderService.sendRound(id, body);
        reply.send(order);
      },
    );

    // POST /orders/:id/close
    fastify.post(
      '/:id/close',
      {
        schema: {
          body: CloseOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as CloseOrderRequest;
        const order = await orderService.closeOrder(id, body);
        reply.send(order);
      },
    );

    // POST /orders/:id/cancel
    fastify.post(
      '/:id/cancel',
      {
        schema: {
          body: CancelOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as CancelOrderRequest;
        const order = await orderService.cancelOrder(id, body);
        reply.send(order);
      },
    );

    // PUT /orders/:id/tables
    fastify.put(
      '/:id/tables',
      {
        schema: {
          body: UpdateOrderTablesRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as UpdateOrderTablesRequest;
        const order = await orderService.updateTables(id, body);
        reply.send(order);
      },
    );
  };
}
