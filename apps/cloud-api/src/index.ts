import fastify from 'fastify';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { loadCloudConfig } from '@comanview/config';
import {
  CloudAdminAuthRepository,
  CloudControlPlaneRepository,
  CloudLicensingRepository,
  CloudReadRepository,
  CloudSyncRepository,
  CloudRecoveryRepository,
  createCloudDatabase,
} from '@comanview/database';
import {
  HeartbeatAckSchema,
  MAX_SYNC_BATCH_SIZE,
  SyncBatchAckSchema,
  type EdgeHeartbeat,
} from '@comanview/sync';
import { CloudError } from './app/CloudError.js';
import { EdgeAuthenticator, hashEdgeToken, type EdgeLookup } from './auth/EdgeAuthenticator.js';
import {
  CloudSyncService,
  type CloudSyncPersistence,
  type RawSyncBatch,
} from './sync/CloudSyncService.js';
import { CloudAdminAuthService } from './admin/CloudAdminAuthService.js';
import { CloudControlPlaneService } from './provisioning/CloudControlPlaneService.js';
import { registerProvisioningRoutes } from './provisioning/routes.js';
import { registerCloudControlPlaneRoutes } from './admin/controlPlaneRoutes.js';
import {
  ControlPlaneConflictError,
  ControlPlaneInvalidCodeError,
  ControlPlaneNotFoundError,
} from '@comanview/database';
import {
  registerCloudAdminRoutes,
  type CloudAdminRouteDependencies,
} from './admin/routes.js';
import { CloudLicensingService } from './licensing/CloudLicensingService.js';
import { registerCloudLicensingRoutes } from './licensing/routes.js';
import { LicensingConflictError } from '@comanview/database';
import { RecoveryAuthorizationConflictError } from '@comanview/database';
import { CloudRecoveryService } from './recovery/CloudRecoveryService.js';

const RawSyncBatchSchema = z.object({
  protocolVersion: z.string(),
  edgeId: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  batchId: z.string().uuid(),
  events: z.array(z.unknown()).min(1).max(MAX_SYNC_BATCH_SIZE),
});

export interface CloudRepository extends EdgeLookup, CloudSyncPersistence {
  countInboxEvents(): Promise<number>;
}

export interface BuildCloudAppOptions {
  repository: CloudRepository;
  bodyLimit?: number;
  maxBatchSize?: number;
  admin?: CloudAdminRouteDependencies;
  controlPlane?: CloudControlPlaneService;
  licensing?: CloudLicensingService;
  recovery?: CloudRecoveryService;
}

export function buildCloudApp(options: BuildCloudAppOptions) {
  const app = fastify({ logger: true, bodyLimit: options.bodyLimit ?? 1_048_576 });
  const authenticator = new EdgeAuthenticator(options.repository);
  const service = new CloudSyncService(options.repository);
  const maxBatchSize = options.maxBatchSize ?? MAX_SYNC_BATCH_SIZE;

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CloudError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Invalid request.',
      });
    }
    if (error instanceof ControlPlaneInvalidCodeError) {
      return reply.status(401).send({ error: 'PROVISIONING_CODE_INVALID', message: 'Provisioning code is invalid, expired, revoked, or consumed.' });
    }
    if (error instanceof ControlPlaneNotFoundError) {
      return reply.status(404).send({ error: 'CLOUD_RESOURCE_NOT_FOUND', message: 'Resource was not found.' });
    }
    if (error instanceof ControlPlaneConflictError) {
      const message = error.code === 'EDGE_REPLACEMENT_PENDING'
        ? 'Cancel the pending Replacement before revoking this Edge.'
        : error.code === 'EDGE_REPLACEMENT_OLD_EDGE_NOT_ACTIVE'
          ? 'Replacement cutover requires the old Edge to remain ACTIVE.'
          : 'Control plane state does not allow this operation.';
      return reply.status(409).send({ error: error.code, message });
    }
    if (error instanceof LicensingConflictError) {
      return reply.status(409).send({ error: error.code, message: 'Licensing state changed or does not allow this operation.' });
    }
    if(error instanceof RecoveryAuthorizationConflictError){
      return reply.status(409).send({error:error.code,message:'Recovery authorization state does not allow this operation.'});
    }
    const requestError = error as Error & { statusCode?: number };
    if (typeof requestError.statusCode === 'number' && requestError.statusCode < 500) {
      return reply.status(requestError.statusCode).send({
        error: requestError.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'REQUEST_ERROR',
        message: requestError.message,
      });
    }
    app.log.error({ err: error }, 'Cloud request failed');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error.' });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await options.repository.countInboxEvents();
      return { status: 'UP', database: 'OK' };
    } catch {
      return reply.status(503).send({ status: 'DOWN', database: 'ERROR' });
    }
  });

  app.post('/sync/v1/events', async (request, reply) => {
    const edge = await authenticator.authenticate(
      request.headers['x-comanview-edge-id'],
      request.headers.authorization,
    );
    const batch = RawSyncBatchSchema.parse(request.body) as RawSyncBatch;
    if (batch.events.length > maxBatchSize) {
      throw new CloudError('SYNC_BATCH_TOO_LARGE', 413, 'Sync batch exceeds configured limit.');
    }
    const ack = await service.ingest(edge, batch);
    reply.status(200).send(SyncBatchAckSchema.parse(ack));
  });

  app.post('/sync/v1/heartbeat', async (request, reply) => {
    const edge = await authenticator.authenticate(
      request.headers['x-comanview-edge-id'],
      request.headers.authorization,
    );
    const receivedAt = await service.heartbeat(edge, request.body as EdgeHeartbeat);
    const desiredControlRevision = options.licensing
      ? await options.licensing.desiredRevision(edge.edgeId)
      : undefined;
    reply.send(HeartbeatAckSchema.parse({ edgeId: edge.edgeId,
      receivedAt: receivedAt.toISOString(), desiredControlRevision }));
  });

  if (options.controlPlane) registerProvisioningRoutes(app, options.controlPlane, authenticator);
  if (options.admin) {
    registerCloudAdminRoutes(app, options.admin);
    if (options.controlPlane) registerCloudControlPlaneRoutes(app, { auth: options.admin.auth, service: options.controlPlane });
    if (options.licensing) registerCloudLicensingRoutes(app, {
      auth: options.admin.auth, authenticator, service: options.licensing,
      ...(options.recovery?{recovery:options.recovery}:{}),
    });
  }

  return app;
}

async function start(): Promise<void> {
  const config = loadCloudConfig();
  const database = createCloudDatabase(config.databaseUrl);
  const repository = new CloudSyncRepository(database.db);
  const adminRepository = new CloudAdminAuthRepository(database.pool);
  const adminAuth = new CloudAdminAuthService(adminRepository, config.admin);
  const cloudRead = new CloudReadRepository(database.pool, config.admin.projectionVersion);
  const licensingRepository = new CloudLicensingRepository(database.pool);
  const licensing = config.licensing
    ? new CloudLicensingService(licensingRepository, config.licensing)
    : undefined;
  const recovery=licensing&&config.licensing
    ?new CloudRecoveryService(new CloudRecoveryRepository(database.pool),config.licensing):undefined;
  const controlPlane = new CloudControlPlaneService(
    new CloudControlPlaneRepository(database.pool), config.provisioning, () => new Date(),
    licensing ? async (locationId) => {
      if (!(await licensingRepository.getLocationAssignment(locationId))) {
        throw new CloudError('LOCATION_LICENSE_REQUIRED', 409,
          'Assign a commercial license before provisioning an Edge.');
      }
    } : undefined,
  );
  const app = buildCloudApp({
    repository,
    bodyLimit: config.bodyLimit,
    maxBatchSize: config.maxBatchSize,
    admin: { auth: adminAuth, read: cloudRead, config: config.admin },
    controlPlane,
    ...(licensing ? { licensing } : {}),
    ...(recovery ? { recovery } : {}),
  });
  app.addHook('onClose', () => database.close());
  try {
    for (const credential of config.edgeCredentials) {
      await repository.provisionEdge({
        edgeId: credential.edgeId,
        tenantId: credential.tenantId,
        locationId: credential.locationId,
        credentialHash: hashEdgeToken(credential.token),
      });
    }
    await adminAuth.provisionDevelopmentAdmin();
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error({ err: error }, 'Cloud API startup failed');
    await app.close();
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await start();
}
