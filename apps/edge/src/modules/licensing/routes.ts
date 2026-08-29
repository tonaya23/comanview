import type { FastifyPluginAsync } from 'fastify';
import { EffectiveCapabilitiesResponseSchema } from '@comanview/contracts';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import type { EdgeLicenseManager } from './EdgeLicenseManager.js';

export function licensingRoutes(manager: EdgeLicenseManager, authGuard: AuthGuard): FastifyPluginAsync {
  return async (app) => {
    app.get('/licensing/status', { preHandler: authGuard.authenticated }, async () =>
      EffectiveCapabilitiesResponseSchema.parse(manager.effectiveCapabilities()));
    app.get('/licensing/configuration', { preHandler: authGuard.authenticated }, async () =>
      manager.currentConfiguration());
  };
}
