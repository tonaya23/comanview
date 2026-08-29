import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOUD_PERMISSIONS } from '@comanview/auth';
import type { EdgeReplacementRecord } from '@comanview/database';
import {
  CanonicalCloudLocationListResponseSchema, CreateCloudLocationRequestSchema,
  CancelEdgeReplacementRequestSchema, EdgeReplacementSchema,
  CreateCloudTenantRequestSchema, GenerateProvisioningCodeRequestSchema,
  GeneratedProvisioningCodeResponseSchema, InitiateEdgeReplacementRequestSchema,
  InitiateEdgeReplacementResponseSchema, ProvisionedEdgeListResponseSchema,
  PendingEdgeReplacementResponseSchema,
  ProvisionedEdgeSchema, RevokeEdgeRequestSchema, RevokeProvisioningCodeRequestSchema,
  CloudTenantListResponseSchema,
} from '@comanview/contracts';
import { accessScope, requireCloudPermission, type CloudAdminPrincipal } from './CloudAdminAuthService.js';
import type { CloudAdminAuthService } from './CloudAdminAuthService.js';
import { assertCloudAdminSameOrigin, authenticateCloudAdmin } from './routes.js';
import { CloudError } from '../app/CloudError.js';
import {
  CloudControlPlaneService, canonicalLocationResponse, provisionedEdgeResponse,
  provisioningCodeResponse, tenantResponse,
} from '../provisioning/CloudControlPlaneService.js';

const TenantParams = z.object({ tenantId: z.string().uuid() });
const LocationParams = z.object({ locationId: z.string().uuid() });
const CodeParams = z.object({ codeId: z.string().uuid() });
const EdgeParams = z.object({ edgeId: z.string().uuid() });
const ReplacementParams = z.object({ replacementId: z.string().uuid() });

export function registerCloudControlPlaneRoutes(app: FastifyInstance, input: {
  auth: CloudAdminAuthService; service: CloudControlPlaneService;
}): void {
  app.get('/admin/v1/tenants', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const scope = accessScope(principal);
    return CloudTenantListResponseSchema.parse({ data: (await input.service.listTenants(scope.global, scope.tenantIds)).map(tenantResponse) });
  });
  app.post('/admin/v1/tenants', async (request, reply) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_TENANT_CREATE);
    const tenant = await input.service.createTenant(CreateCloudTenantRequestSchema.parse(request.body), actor(principal));
    reply.status(201); return tenantResponse(tenant);
  });
  app.get('/admin/v1/tenants/:tenantId/locations', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const { tenantId } = TenantParams.parse(request.params); assertTenant(principal, tenantId);
    return CanonicalCloudLocationListResponseSchema.parse({ data: (await input.service.listLocations(tenantId)).map(canonicalLocationResponse) });
  });
  app.post('/admin/v1/tenants/:tenantId/locations', async (request, reply) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_LOCATION_CREATE);
    const { tenantId } = TenantParams.parse(request.params); assertTenant(principal, tenantId);
    const location = await input.service.createLocation(tenantId, CreateCloudLocationRequestSchema.parse(request.body), actor(principal));
    reply.status(201); return canonicalLocationResponse(location);
  });
  app.get('/admin/v1/locations/:locationId/edges', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const { locationId } = LocationParams.parse(request.params);
    await assertLocation(input.service, principal, locationId);
    return ProvisionedEdgeListResponseSchema.parse({ data: (await input.service.listEdges(locationId)).map(provisionedEdgeResponse) });
  });
  app.post('/admin/v1/locations/:locationId/provisioning-codes', async (request, reply) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_EDGE_PROVISION);
    const { locationId } = LocationParams.parse(request.params); await assertLocation(input.service, principal, locationId);
    const body = GenerateProvisioningCodeRequestSchema.parse(request.body);
    const result = await input.service.generateCode(locationId, body.commandId, actor(principal));
    reply.status(201); return GeneratedProvisioningCodeResponseSchema.parse(provisioningCodeResponse(result));
  });
  app.post('/admin/v1/provisioning-codes/:codeId/revoke', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_EDGE_PROVISION);
    const { codeId } = CodeParams.parse(request.params);
    const code = await input.service.getProvisioningCode(codeId);
    if (!code) throw notFound();
    await assertLocation(input.service, principal, code.locationId);
    const body = RevokeProvisioningCodeRequestSchema.parse(request.body);
    return provisioningCodeResponse(await input.service.revokeCode(codeId, body.commandId, actor(principal)));
  });
  app.post('/admin/v1/edges/:edgeId/revoke', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_EDGE_REVOKE);
    const { edgeId } = EdgeParams.parse(request.params);
    await findVisibleEdge(input.service, principal, edgeId);
    return ProvisionedEdgeSchema.parse(provisionedEdgeResponse(await input.service.revokeEdge(edgeId, RevokeEdgeRequestSchema.parse(request.body), actor(principal))));
  });
  app.post('/admin/v1/locations/:locationId/replacements', async (request, reply) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_EDGE_REPLACE);
    const { locationId } = LocationParams.parse(request.params); await assertLocation(input.service, principal, locationId);
    const body = InitiateEdgeReplacementRequestSchema.parse(request.body);
    if (!(await input.service.listEdges(locationId)).some((edge) => edge.edgeId === body.oldEdgeId)) throw notFound();
    const result = await input.service.initiateReplacement(locationId, body, actor(principal));
    reply.status(201); return InitiateEdgeReplacementResponseSchema.parse({ ...result,
      provisioningCode: provisioningCodeResponse(result.provisioningCode) });
  });
  app.get('/admin/v1/locations/:locationId/replacements/pending', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const { locationId } = LocationParams.parse(request.params);
    await assertLocation(input.service, principal, locationId);
    const replacement = await input.service.getPendingReplacement(locationId);
    return PendingEdgeReplacementResponseSchema.parse({
      replacement: replacement ? edgeReplacementResponse(replacement) : null,
    });
  });
  app.post('/admin/v1/replacements/:replacementId/cancel', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_EDGE_REPLACE);
    const { replacementId } = ReplacementParams.parse(request.params);
    const replacement = await input.service.getReplacement(replacementId);
    if (!replacement) throw notFound();
    await assertLocation(input.service, principal, replacement.locationId);
    return EdgeReplacementSchema.parse(edgeReplacementResponse(await input.service.cancelReplacement(
      replacementId,
      CancelEdgeReplacementRequestSchema.parse(request.body),
      actor(principal),
    )));
  });
}

function edgeReplacementResponse(record: EdgeReplacementRecord) {
  return {
    ...record,
    initiatedAt: record.initiatedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    provisioningCode: provisioningCodeResponse(record.provisioningCode),
  };
}

async function writePrincipal(request: FastifyRequest, auth: CloudAdminAuthService, permission: Parameters<typeof requireCloudPermission>[1]) {
  assertCloudAdminSameOrigin(request);
  const principal = await authenticateCloudAdmin(request, auth); requireCloudPermission(principal, permission); return principal;
}
function actor(principal: CloudAdminPrincipal) { return { userId: principal.userId, sessionId: principal.session.id }; }
function assertTenant(principal: CloudAdminPrincipal, tenantId: string) {
  const scope = accessScope(principal); if (!scope.global && !scope.tenantIds.includes(tenantId)) throw notFound();
}
async function assertLocation(service: CloudControlPlaneService, principal: CloudAdminPrincipal, locationId: string) {
  const location = await service.getLocation(locationId); if (!location) throw notFound(); assertTenant(principal, location.tenantId); return location;
}
async function findVisibleEdge(service: CloudControlPlaneService, principal: CloudAdminPrincipal, edgeId: string) {
  const tenants = await service.listTenants(accessScope(principal).global, principal.tenantGrants);
  for (const tenant of tenants) for (const location of await service.listLocations(tenant.tenantId)) {
    if ((await service.listEdges(location.locationId)).some((edge) => edge.edgeId === edgeId)) return edgeId;
  }
  throw notFound();
}
function notFound() { return new CloudError('CLOUD_RESOURCE_NOT_FOUND', 404, 'Resource was not found.'); }
