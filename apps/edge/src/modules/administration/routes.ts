import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { RestaurantAdministrationCommandSchema,RestaurantAdministrationResultSchema,RestaurantAdministrationStateSchema,PublicBusinessProfileSchema } from '@comanview/contracts';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import { actorFrom } from '../auth/http/AuthGuard.js';
import type { AdministrationService } from './AdministrationService.js';
export function administrationRoutes(service:AdministrationService,guard:AuthGuard):FastifyPluginAsyncZod{return async app=>{
  app.get('/administration',{preHandler:guard.requirePermission('ADMINISTRATION_VIEW'),schema:{response:{200:RestaurantAdministrationStateSchema}}},()=>service.state());
  app.get('/business-profile/public',{preHandler:guard.requirePermission('CATALOG_VIEW'),schema:{response:{200:PublicBusinessProfileSchema}}},()=>service.publicProfile());
  app.post('/administration/commands',{preHandler:guard.authenticated,schema:{body:RestaurantAdministrationCommandSchema,response:{200:RestaurantAdministrationResultSchema}}},req=>service.execute(req.body,actorFrom(req)));
};}
