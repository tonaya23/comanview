import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CLOUD_PERMISSIONS } from '@comanview/auth';
import {
  AssignLocationLicenseRequestSchema,
  CloudPlanListResponseSchema,
  CloudPlanSchema,
  CreateCloudPlanRequestSchema,
  EdgeControlAckRequestSchema,
  EdgeControlStateResponseSchema,
  LocationLicenseAssignmentSchema,
  UpdateLocationConfigurationRequestSchema,
  UpdateLocationLicenseStateRequestSchema,
  IssueInstallationAuthorizationRequestSchema,
  IssuedInstallationAuthorizationSchema,
  InstallationAuthorizationAckRequestSchema,
  LatestInstallationAuthorizationResponseSchema,
  IssueRecoveryAuthorizationRequestSchema,IssuedRecoveryAuthorizationSchema,ConsumeRecoveryAuthorizationRequestSchema,
} from '@comanview/contracts';
import type { EdgeAuthenticator } from '../auth/EdgeAuthenticator.js';
import type { CloudAdminAuthService, CloudAdminPrincipal } from '../admin/CloudAdminAuthService.js';
import { accessScope, requireCloudPermission } from '../admin/CloudAdminAuthService.js';
import { assertCloudAdminSameOrigin, authenticateCloudAdmin } from '../admin/routes.js';
import { CloudError } from '../app/CloudError.js';
import { assignmentResponse, CloudLicensingService, planResponse } from './CloudLicensingService.js';
import type { CloudRecoveryService } from '../recovery/CloudRecoveryService.js';

const LocationParams = z.object({ locationId: z.string().uuid() });

export function registerCloudLicensingRoutes(app: FastifyInstance, input: {
  auth: CloudAdminAuthService;
  authenticator: EdgeAuthenticator;
  service: CloudLicensingService;
  recovery?: CloudRecoveryService;
}): void {
  app.get('/admin/v1/plans', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    return CloudPlanListResponseSchema.parse({ data: (await input.service.listPlans()).map(planResponse) });
  });
  app.post('/admin/v1/plans', async (request, reply) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_PLAN_MANAGE);
    const plan = await input.service.createPlan(CreateCloudPlanRequestSchema.parse(request.body), actor(principal));
    reply.status(201);
    return CloudPlanSchema.parse(planResponse(plan));
  });
  app.get('/admin/v1/locations/:locationId/license', async (request) => {
    const principal = await authenticateCloudAdmin(request, input.auth);
    requireCloudPermission(principal, CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW);
    const { locationId } = LocationParams.parse(request.params);
    const assignment = await input.service.getLocationAssignment(locationId);
    if (!assignment || !canAccessTenant(principal, assignment.tenantId)) throw notFound();
    return LocationLicenseAssignmentSchema.parse(assignmentResponse(assignment));
  });
  app.put('/admin/v1/locations/:locationId/license', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_LICENSE_MANAGE);
    const { locationId } = LocationParams.parse(request.params);
    const body = AssignLocationLicenseRequestSchema.parse(request.body);
    const tenantId = await input.service.getAssignmentTenant(locationId, body.planId);
    if (!tenantId || !canAccessTenant(principal, tenantId)) throw notFound();
    const assignment = await input.service.assignLocation(locationId, body, actor(principal));
    return LocationLicenseAssignmentSchema.parse(assignmentResponse(assignment));
  });
  app.patch('/admin/v1/locations/:locationId/license/state', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_LICENSE_MANAGE);
    const { locationId } = LocationParams.parse(request.params);
    const current = await input.service.getLocationAssignment(locationId);
    if (!current || !canAccessTenant(principal, current.tenantId)) throw notFound();
    return LocationLicenseAssignmentSchema.parse(assignmentResponse(await input.service.updateState(
      locationId, UpdateLocationLicenseStateRequestSchema.parse(request.body), actor(principal),
    )));
  });
  app.patch('/admin/v1/locations/:locationId/configuration', async (request) => {
    const principal = await writePrincipal(request, input.auth, CLOUD_PERMISSIONS.CLOUD_CONFIGURATION_MANAGE);
    const { locationId } = LocationParams.parse(request.params);
    const current = await input.service.getLocationAssignment(locationId);
    if (!current || !canAccessTenant(principal, current.tenantId)) throw notFound();
    return LocationLicenseAssignmentSchema.parse(assignmentResponse(await input.service.updateConfiguration(
      locationId, UpdateLocationConfigurationRequestSchema.parse(request.body), actor(principal),
    )));
  });
  app.post('/admin/v1/locations/:locationId/installation-authorizations',async(request,reply)=>{
    const principal=await writePrincipal(request,input.auth,CLOUD_PERMISSIONS.CLOUD_DEVICE_BOOTSTRAP);
    const {locationId}=LocationParams.parse(request.params);
    const current=await input.service.getLocationAssignment(locationId);
    if(!current||!canAccessTenant(principal,current.tenantId)) throw notFound();
    reply.status(201);
    return IssuedInstallationAuthorizationSchema.parse(await input.service.issueInstallationAuthorization(locationId,IssueInstallationAuthorizationRequestSchema.parse(request.body),actor(principal)));
  });
  app.get('/admin/v1/locations/:locationId/installation-authorizations/latest',async(request)=>{
    const principal=await authenticateCloudAdmin(request,input.auth);
    requireCloudPermission(principal,CLOUD_PERMISSIONS.CLOUD_DEVICE_BOOTSTRAP);
    const {locationId}=LocationParams.parse(request.params);
    const current=await input.service.getLocationAssignment(locationId);
    if(!current||!canAccessTenant(principal,current.tenantId))throw notFound();
    const authorization=await input.service.getLatestInstallationAuthorization(locationId);
    return LatestInstallationAuthorizationResponseSchema.parse({authorization:authorization?{
      authorizationId:authorization.authorizationId,status:authorization.status,
      issuedAt:authorization.issuedAt.toISOString(),expiresAt:authorization.expiresAt.toISOString(),
      consumedAt:authorization.consumedAt?.toISOString()??null,
    }:null});
  });

  app.get('/edge/v1/control-state', async (request) => {
    const edge = await input.authenticator.authenticate(
      request.headers['x-comanview-edge-id'], request.headers.authorization,
    );
    return EdgeControlStateResponseSchema.parse(await input.service.controlState(edge.edgeId));
  });
  if(input.recovery){
    app.post('/admin/v1/locations/:locationId/recovery-authorizations',async(request,reply)=>{
      const principal=await writePrincipal(request,input.auth,CLOUD_PERMISSIONS.CLOUD_RECOVERY_AUTHORIZE);
      const {locationId}=LocationParams.parse(request.params);const current=await input.service.getLocationAssignment(locationId);
      if(!current||!canAccessTenant(principal,current.tenantId))throw notFound();
      reply.status(201);return IssuedRecoveryAuthorizationSchema.parse(await input.recovery!.issue({locationId,
        ...IssueRecoveryAuthorizationRequestSchema.parse(request.body)},actor(principal)));
    });
    app.post('/edge/v1/recovery-authorizations/acks',async(request,reply)=>{
      const edge=await input.authenticator.authenticate(request.headers['x-comanview-edge-id'],request.headers.authorization);
      await input.recovery!.consume(edge.edgeId,ConsumeRecoveryAuthorizationRequestSchema.parse(request.body));reply.status(204).send();
    });
  }
  app.post('/edge/v1/control-state/acks', async (request, reply) => {
    const edge = await input.authenticator.authenticate(
      request.headers['x-comanview-edge-id'], request.headers.authorization,
    );
    await input.service.acknowledge(edge.edgeId, EdgeControlAckRequestSchema.parse(request.body));
    reply.status(204).send();
  });
  app.post('/edge/v1/installation-authorizations/acks',async(request,reply)=>{
    const edge=await input.authenticator.authenticate(request.headers['x-comanview-edge-id'],request.headers.authorization);
    await input.service.consumeInstallationAuthorization(edge.edgeId,InstallationAuthorizationAckRequestSchema.parse(request.body));
    reply.status(204).send();
  });
}

async function writePrincipal(request: FastifyRequest, auth: CloudAdminAuthService,
  permission: Parameters<typeof requireCloudPermission>[1]) {
  assertCloudAdminSameOrigin(request);
  const principal = await authenticateCloudAdmin(request, auth);
  requireCloudPermission(principal, permission);
  return principal;
}
function actor(principal: CloudAdminPrincipal) { return { userId: principal.userId, sessionId: principal.session.id }; }
function canAccessTenant(principal: CloudAdminPrincipal, tenantId: string) {
  const scope = accessScope(principal); return scope.global || scope.tenantIds.includes(tenantId);
}
function notFound() { return new CloudError('CLOUD_RESOURCE_NOT_FOUND', 404, 'Resource was not found.'); }
