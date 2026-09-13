import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';import { TaxAdministrationCommandSchema,TaxAdministrationResultSchema,TaxAdministrationStateSchema } from '@comanview/contracts';
import type { AuthGuard } from '../auth/http/AuthGuard.js';import { actorFrom } from '../auth/http/AuthGuard.js';import type { TaxAdministrationService } from './TaxAdministrationService.js';
export function taxAdministrationRoutes(service:TaxAdministrationService,guard:AuthGuard):FastifyPluginAsyncZod{return async app=>{
  app.get('/administration/taxes',{preHandler:guard.requirePermission('ADMINISTRATION_VIEW'),schema:{response:{200:TaxAdministrationStateSchema}}},()=>service.state());
  app.post('/administration/taxes/commands',{preHandler:guard.authenticated,schema:{body:TaxAdministrationCommandSchema,response:{200:TaxAdministrationResultSchema}}},req=>service.execute(req.body,actorFrom(req)));
};}
