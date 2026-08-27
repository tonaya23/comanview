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
  UpdateDraftOrderItemConfigurationRequestSchema,
  UpdateDraftOrderItemConfigurationRequest,
} from '@comanview/contracts';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';

export function orderRoutes(orderService: OrderService, auth: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    // POST /orders
    fastify.post(
      '/',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_CREATE),
        schema: {
          body: CreateOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const body = request.body as CreateOrderRequest;
        const order = await orderService.createOrder(
          body,
          operationFrom(request, PERMISSIONS.ORDER_CREATE),
        );
        reply.status(201).send(order);
      },
    );

    // PATCH /orders/:id/items/:itemId/instructions
    fastify.patch(
      '/:id/items/:itemId/instructions',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_EDIT_DRAFT),
        schema: {
          body: UpdateOrderItemSpecialInstructionsRequestSchema,
        },
      },
      async (request, reply) => {
        const { id, itemId } = request.params as { id: string; itemId: string };
        const body = request.body as UpdateOrderItemSpecialInstructionsRequest;
        const order = await orderService.updateItemSpecialInstructions(
          id,
          itemId,
          body,
          operationFrom(request, PERMISSIONS.ORDER_EDIT_DRAFT),
        );
        reply.send(order);
      },
    );

    // PATCH /orders/:id/items/:itemId/configuration
    fastify.patch(
      '/:id/items/:itemId/configuration',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_EDIT_DRAFT),
        schema: {
          body: UpdateDraftOrderItemConfigurationRequestSchema,
        },
      },
      async (request, reply) => {
        const { id, itemId } = request.params as { id: string; itemId: string };
        const body = request.body as UpdateDraftOrderItemConfigurationRequest;
        const order = await orderService.updateDraftItemConfiguration(
          id,
          itemId,
          body,
          operationFrom(request, PERMISSIONS.ORDER_EDIT_DRAFT),
        );
        reply.send(order);
      },
    );

    // GET /orders/:id
    fastify.get(
      '/:id',
      { preHandler: auth.requirePermission(PERMISSIONS.ORDER_VIEW) },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const order = await orderService.getOrder(id);

        if (!order) {
          reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
          return;
        }

        reply.send(order);
      },
    );

    // POST /orders/:id/items
    fastify.post(
      '/:id/items',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_EDIT_DRAFT),
        schema: {
          body: AddOrderItemRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as AddOrderItemRequest;
        const order = await orderService.addItem(
          id,
          body,
          operationFrom(request, PERMISSIONS.ORDER_EDIT_DRAFT),
        );
        reply.send(order);
      },
    );

    // DELETE /orders/:id/items/:itemId
    fastify.delete(
      '/:id/items/:itemId',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_EDIT_DRAFT),
        schema: {
          body: RemoveOrderItemRequestSchema,
        },
      },
      async (request, reply) => {
        const { id, itemId } = request.params as { id: string; itemId: string };
        const body = request.body as RemoveOrderItemRequest;
        const order = await orderService.removeItem(
          id,
          itemId,
          body,
          operationFrom(request, PERMISSIONS.ORDER_EDIT_DRAFT),
        );
        reply.send(order);
      },
    );

    // POST /orders/:id/rounds
    fastify.post(
      '/:id/rounds',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_SEND),
        schema: {
          body: SendRoundRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as SendRoundRequest;
        const order = await orderService.sendRound(
          id,
          body,
          operationFrom(request, PERMISSIONS.ORDER_SEND),
        );
        reply.send(order);
      },
    );

    // POST /orders/:id/close
    fastify.post(
      '/:id/close',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_CLOSE),
        schema: {
          body: CloseOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as CloseOrderRequest;
        const order = await orderService.closeOrder(
          id,
          body,
          operationFrom(request, PERMISSIONS.ORDER_CLOSE),
        );
        reply.send(order);
      },
    );

    // POST /orders/:id/cancel
    fastify.post(
      '/:id/cancel',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_CANCEL),
        schema: {
          body: CancelOrderRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as CancelOrderRequest;
        const order = await orderService.cancelOrder(
          id,
          body,
          operationFrom(request, PERMISSIONS.ORDER_CANCEL),
        );
        reply.send(order);
      },
    );

    // PUT /orders/:id/tables
    fastify.put(
      '/:id/tables',
      {
        preHandler: auth.requirePermission(PERMISSIONS.ORDER_EDIT_DRAFT),
        schema: {
          body: UpdateOrderTablesRequestSchema,
        },
      },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as UpdateOrderTablesRequest;
        const order = await orderService.updateTables(
          id,
          body,
          operationFrom(request, PERMISSIONS.ORDER_EDIT_DRAFT),
        );
        reply.send(order);
      },
    );
  };
}
