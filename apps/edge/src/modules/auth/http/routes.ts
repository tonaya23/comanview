import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CurrentSessionResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  type LoginRequest,
} from '@comanview/contracts';
import type { AuthService } from '../application/AuthService.js';
import type { AuthGuard } from './AuthGuard.js';
import { actorFrom } from './AuthGuard.js';

export function authRoutes(service: AuthService, guard: AuthGuard): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.post(
      '/login',
      { schema: { body: LoginRequestSchema, response: { 200: LoginResponseSchema } } },
      async (request, reply) => reply.send(await service.login(request.body as LoginRequest)),
    );
    fastify.get(
      '/session',
      {
        preHandler: guard.authenticated,
        schema: { response: { 200: CurrentSessionResponseSchema } },
      },
      async (request, reply) => reply.send(service.current(actorFrom(request))),
    );
    fastify.post(
      '/logout',
      {
        preHandler: guard.authenticated,
        schema: { response: { 200: LogoutResponseSchema } },
      },
      async (request, reply) => {
        service.logout(actorFrom(request));
        reply.send({ revoked: true as const });
      },
    );
  };
}
