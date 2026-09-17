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
        const actor = auth.authenticateRealtimeActorAny('', [PERMISSIONS.ORDER_VIEW]);
        realtime.subscribe(socket, actor!.locationId);
        return;
      }

      let sessionToken: string | null = null;
      let revalidate:(()=>void)|null=null;
      let closed=false;
      const realtimePermissions = [PERMISSIONS.ORDER_VIEW, PERMISSIONS.KDS_VIEW] as const;
      const authenticationTimeout = setTimeout(
        () => socket.close(1008, 'Local session authentication required.'),
        5_000,
      );
      const validityInterval = setInterval(() => {
        revalidate?.();
      }, 5_000);
      validityInterval.unref();

      socket.once('message', async (payload: Buffer) => {
        try {
          const message = JSON.parse(payload.toString()) as { type?: unknown; token?: unknown };
          const token = typeof message.token === 'string' ? message.token : null;
          if(message.type!=='AUTHENTICATE'||!token){
            socket.close(1008, 'Invalid local session.');
            return;
          }
          clearTimeout(authenticationTimeout);
          const deadline=setTimeout(()=>{closed=true;socket.close(1013,'SECURITY_VALIDATION_PENDING');},5000);
          const result=await auth.withRealtimeAuthorization(token,realtimePermissions,actor=>{
            if(closed||socket.readyState!==1)return;
            sessionToken=token;
            revalidate=realtime.subscribe(socket,actor.locationId,deliver=>
              auth.withRealtimeAuthorization(token,realtimePermissions,()=>deliver()));
            socket.send(JSON.stringify({type:'AUTHENTICATED'}));
          });
          clearTimeout(deadline);
          if(!closed&&result!=='AUTHORIZED')socket.close(result==='INVALID'?1008:1013,
            result==='INVALID'?'AUTH_SESSION_INVALID':'SECURITY_VALIDATION_PENDING');
        } catch {
          socket.close(1008, 'Invalid authentication message.');
        }
      });
      socket.on('close', (code:number) => {
        if(process.env['COMANVIEW_SECURITY_TRACE']==='true')fastify.log.info({event:'WS_CLOSED',code},'Security trace');
        clearTimeout(authenticationTimeout);
        clearInterval(validityInterval);
        sessionToken = null;
        closed=true;revalidate=null;
      });
    });
  };
}
