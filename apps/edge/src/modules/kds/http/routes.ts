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
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { operationFrom } from '../../auth/http/AuthGuard.js';

export function kdsRoutes(
  service: KdsService,
  realtime: RealtimeHub,
  auth: AuthGuard,
): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get(
      '/kds/stations',
      {
        preHandler: auth.requirePermission(PERMISSIONS.KDS_VIEW),
        schema: { response: { 200: KdsStationSchema.array() } },
      },
      async (_request, reply) => reply.send(service.listStations()),
    );
    fastify.get(
      '/kds/tickets',
      {
        preHandler: auth.requirePermission(PERMISSIONS.KDS_VIEW),
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
        preHandler: auth.requirePermission(PERMISSIONS.KDS_UPDATE_PREPARATION),
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
            operationFrom(request, PERMISSIONS.KDS_UPDATE_PREPARATION),
          ),
        );
      },
    );
    fastify.post(
      '/kds/tickets/:roundId/:stationId/ready',
      {
        preHandler: auth.requirePermission(PERMISSIONS.KDS_UPDATE_PREPARATION),
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
            operationFrom(request, PERMISSIONS.KDS_UPDATE_PREPARATION),
          ),
        );
      },
    );
    fastify.get('/realtime', { websocket: true }, (socket) => {
      if (auth.bypassesAuthentication) {
        realtime.subscribe(socket);
        return;
      }

      let sessionToken: string | null = null;
      const authenticationTimeout = setTimeout(
        () => socket.close(1008, 'Local session authentication required.'),
        5_000,
      );
      const validityInterval = setInterval(() => {
        if (sessionToken && !auth.isRealtimeSessionValid(sessionToken, PERMISSIONS.KDS_VIEW)) {
          socket.close(1008, 'Local session is no longer authorized.');
        }
      }, 5_000);
      validityInterval.unref();

      socket.once('message', (payload: Buffer) => {
        try {
          const message = JSON.parse(payload.toString()) as { type?: unknown; token?: unknown };
          if (
            message.type !== 'AUTHENTICATE' ||
            typeof message.token !== 'string' ||
            !auth.authenticateRealtime(message.token, PERMISSIONS.KDS_VIEW)
          ) {
            socket.close(1008, 'Invalid local session.');
            return;
          }
          sessionToken = message.token;
          clearTimeout(authenticationTimeout);
          realtime.subscribe(socket, () =>
            auth.isRealtimeSessionValid(sessionToken!, PERMISSIONS.KDS_VIEW),
          );
          socket.send(JSON.stringify({ type: 'AUTHENTICATED' }));
        } catch {
          socket.close(1008, 'Invalid authentication message.');
        }
      });
      socket.on('close', () => {
        clearTimeout(authenticationTimeout);
        clearInterval(validityInterval);
        sessionToken = null;
      });
    });
  };
}
