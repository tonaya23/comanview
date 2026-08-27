import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  KdsPreparationStatusSchema,
  KdsStationSchema,
  KdsTicketQuerySchema,
  KdsTicketSchema,
  KdsTransitionRequestSchema,
  type KdsTicketQuery,
  type KdsTransitionRequest,
} from '@comanview/contracts';
import type { KdsService } from '../application/KdsService.js';
import type { RealtimeHub } from '../../../infrastructure/realtime/RealtimeHub.js';

export function kdsRoutes(service: KdsService, realtime: RealtimeHub): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/kds/stations',
      { schema: { response: { 200: KdsStationSchema.array() } } },
      async (_request, reply) => reply.send(service.listStations()),
    );
    fastify.get(
      '/kds/tickets',
      {
        schema: {
          querystring: KdsTicketQuerySchema,
          response: { 200: KdsTicketSchema.array() },
        },
      },
      async (request, reply) => {
        const query = request.query as KdsTicketQuery;
        reply.send(service.listTickets(query.stationId, query.status));
      },
    );
    fastify.post(
      '/kds/tickets/:roundId/:stationId/preparing',
      {
        schema: {
          body: KdsTransitionRequestSchema,
          response: { 200: KdsTicketSchema },
        },
      },
      async (request, reply) => {
        const { roundId, stationId } = request.params as { roundId: string; stationId: string };
        reply.send(
          service.transition(
            roundId,
            stationId,
            KdsPreparationStatusSchema.enum.PREPARING,
            request.body as KdsTransitionRequest,
          ),
        );
      },
    );
    fastify.post(
      '/kds/tickets/:roundId/:stationId/ready',
      {
        schema: {
          body: KdsTransitionRequestSchema,
          response: { 200: KdsTicketSchema },
        },
      },
      async (request, reply) => {
        const { roundId, stationId } = request.params as { roundId: string; stationId: string };
        reply.send(
          service.transition(
            roundId,
            stationId,
            KdsPreparationStatusSchema.enum.READY,
            request.body as KdsTransitionRequest,
          ),
        );
      },
    );
    fastify.get('/realtime', { websocket: true }, (socket) => realtime.subscribe(socket));
  };
}
