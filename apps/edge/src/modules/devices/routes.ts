import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS } from '@comanview/auth';
import { ApprovePairingRequestSchema, CancelPairingRequestSchema, CompleteBootstrapRequestSchema,
  CreatePairingRequestSchema, DeviceListResponseSchema, DeviceSchema, InstallationReadinessSchema,
  PairingCreatedSchema, PairingListResponseSchema, PairingStatusResponseSchema, RevokeDeviceRequestSchema } from '@comanview/contracts';
import type { DeviceService } from './DeviceService.js';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import { actorFrom } from '../auth/http/AuthGuard.js';
const Params=z.object({pairingId:z.string().uuid()}); const DeviceParams=z.object({deviceId:z.string().uuid()});
export function deviceRoutes(service:DeviceService,guard:AuthGuard):FastifyPluginAsyncZod{return async(app)=>{
  app.post('/device-pairing/requests',{schema:{body:CreatePairingRequestSchema,response:{201:PairingCreatedSchema}}},async(req,reply)=>reply.status(201).send(service.createPairing(req.body)));
  app.get('/device-pairing/requests/:pairingId',{schema:{params:Params,headers:z.object({'x-pairing-request-token':z.string().min(43)}),response:{200:PairingStatusResponseSchema}}},async(req)=>service.status(req.params.pairingId,req.headers['x-pairing-request-token']));
  app.post('/device-pairing/bootstrap/complete',{schema:{body:CompleteBootstrapRequestSchema,response:{200:DeviceSchema}}},async(req)=>service.completeBootstrap(req.body));
  app.get('/devices',{preHandler:guard.requirePermission(PERMISSIONS.DEVICE_VIEW),schema:{response:{200:DeviceListResponseSchema}}},async()=>service.listDevices());
  app.get('/device-pairing/requests',{preHandler:guard.requirePermission(PERMISSIONS.DEVICE_VIEW),schema:{response:{200:PairingListResponseSchema}}},async()=>service.listPairings());
  app.post('/device-pairing/approve',{preHandler:guard.requirePermission(PERMISSIONS.DEVICE_PAIR),schema:{body:ApprovePairingRequestSchema,response:{200:DeviceSchema}}},async(req)=>service.approve(req.body.pairingId,req.body.pairingCode,req.body.commandId,actorFrom(req)));
  app.post('/device-pairing/:pairingId/cancel',{preHandler:guard.requirePermission(PERMISSIONS.DEVICE_PAIR),schema:{params:Params,body:CancelPairingRequestSchema,response:{200:z.object({cancelled:z.literal(true)})}}},async(req)=>service.cancel(req.params.pairingId,req.body.commandId,actorFrom(req)));
  app.post('/devices/:deviceId/revoke',{preHandler:guard.requirePermission(PERMISSIONS.DEVICE_REVOKE),schema:{params:DeviceParams,body:RevokeDeviceRequestSchema,response:{200:z.object({revoked:z.literal(true)})}}},async(req)=>service.revoke(req.params.deviceId,req.body.reason,req.body.commandId,actorFrom(req)));
  app.get('/installation/readiness',{preHandler:guard.requirePermission(PERMISSIONS.INSTALLATION_READINESS_VIEW),schema:{response:{200:InstallationReadinessSchema}}},async()=>service.readiness());
};}
