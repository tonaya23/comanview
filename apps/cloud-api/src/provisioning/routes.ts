import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ConfirmCredentialRotationRequestSchema, CredentialRotationStatusSchema,
  ProvisioningActivateRequestSchema, ProvisioningActivateResponseSchema,
  ProvisioningExchangeRequestSchema, ProvisioningExchangeResponseSchema,
  RegisterCredentialRotationRequestSchema,
} from '@comanview/contracts';
import type { EdgeAuthenticator } from '../auth/EdgeAuthenticator.js';
import { bearerCredential, CloudControlPlaneService, provisionedEdgeResponse } from './CloudControlPlaneService.js';

const RotationParams = z.object({ rotationId: z.string().uuid() });

export function registerProvisioningRoutes(app: FastifyInstance, service: CloudControlPlaneService, authenticator: EdgeAuthenticator): void {
  app.post('/provisioning/v1/exchange', async (request) => {
    const result = await service.exchange(ProvisioningExchangeRequestSchema.parse(request.body));
    return ProvisioningExchangeResponseSchema.parse({ ...result, edge: provisionedEdgeResponse(result.edge) });
  });
  app.post('/provisioning/v1/activate', async (request) => {
    const input = ProvisioningActivateRequestSchema.parse(request.body);
    const edge = await service.activate(input, bearerCredential(request.headers.authorization));
    return ProvisioningActivateResponseSchema.parse({ edge: provisionedEdgeResponse(edge) });
  });
  app.post('/edge/v1/credentials/rotations', async (request) => {
    const edge = await authenticator.authenticate(request.headers['x-comanview-edge-id'], request.headers.authorization);
    const result = await service.registerRotation(edge.edgeId, RegisterCredentialRotationRequestSchema.parse(request.body));
    return CredentialRotationStatusSchema.parse(result);
  });
  app.post('/edge/v1/credentials/rotations/:rotationId/confirm', async (request) => {
    const { rotationId } = RotationParams.parse(request.params);
    const input = ConfirmCredentialRotationRequestSchema.parse(request.body);
    const result = await service.confirmRotation(rotationId, input, bearerCredential(request.headers.authorization));
    return CredentialRotationStatusSchema.parse({ ...result, previousRetiresAt: result.previousRetiresAt?.toISOString() ?? null });
  });
}
