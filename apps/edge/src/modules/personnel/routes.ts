import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PersonnelListSchema,PersonnelMutationSchema,OwnerRecoveryChallengeRequestSchema,PersonnelRecoveryContextSchema,CompleteOwnerRecoveryRequestSchema } from '@comanview/contracts';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import { actorFrom } from '../auth/http/AuthGuard.js';
import type { PersonnelService } from './PersonnelService.js';
export function personnelRoutes(service:PersonnelService,guard:AuthGuard):FastifyPluginAsyncZod{return async app=>{
  app.get('/administration/personnel',{preHandler:guard.requirePermission('PERSONNEL_VIEW'),schema:{response:{200:PersonnelListSchema}}},()=>service.list());
  app.post('/administration/personnel/commands',{preHandler:guard.authenticated,schema:{body:PersonnelMutationSchema,response:{200:z.object({completed:z.literal(true)})}}},req=>service.mutate(actorFrom(req).sessionId,req.body));
  // No user session is available here. Device proof + Cloud signature are checked
  // within the specialized floor writer; these routes never return a login token.
  app.post('/personnel/recovery/challenge',{schema:{body:OwnerRecoveryChallengeRequestSchema,response:{200:PersonnelRecoveryContextSchema}}},req=>service.challenge(req.body));
  app.post('/personnel/recovery/complete',{schema:{body:CompleteOwnerRecoveryRequestSchema,response:{200:z.object({completed:z.literal(true),loginRequired:z.literal(true)})}}},req=>service.recover(req.body));
};}
