/**
 * @comanview/edge
 *
 * ComanView Edge — Authoritative local operational system.
 *
 * Stack: Fastify · SQLite WAL · better-sqlite3 · Drizzle · Zod · REST + WebSocket
 *
 * ARCHITECTURE:
 * - Edge is the ONLY authoritative financial calculator.
 * - Cloud MUST NOT be required for any local operation.
 * - Internet loss is a normal operating condition.
 * - Browser clients express intent; Edge validates and commits authoritative state.
 */

import fastify, { LogController } from 'fastify';
import websocket from '@fastify/websocket';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { initDatabase, closeDatabase } from './infrastructure/database.js';
import { errorHandler } from './app/errorHandler.js';
import {
  CashRepository,
  CatalogRepository,
  OrderRepository,
  PrintJobRepository,
  KdsRepository,
  AuthRepository,
  AuditRepository,
  TableRepository,
  SyncOutboxRepository,
  EdgeControlRepository,
  DeviceRepository,
} from '@comanview/database';
import { loadEdgeSyncConfig, type EdgeSyncConfig } from '@comanview/config';
import { DebugPrinterAdapter, PrintWorker, type PrinterAdapter } from '@comanview/printing';
import { CatalogService } from './modules/catalog/application/CatalogService.js';
import { OrderService } from './modules/orders/application/OrderService.js';
import { catalogRoutes } from './modules/catalog/http/routes.js';
import { orderRoutes } from './modules/orders/http/routes.js';
import { CashService } from './modules/cash/application/CashService.js';
import { cashRoutes } from './modules/cash/http/routes.js';
import { PaymentService } from './modules/payments/application/PaymentService.js';
import { paymentRoutes } from './modules/payments/http/routes.js';
import { defaultOperationalContext } from './app/operationalContext.js';
import { HealthResponseSchema } from '@comanview/contracts';
import { PrintService } from './modules/printing/application/PrintService.js';
import { printRoutes } from './modules/printing/http/routes.js';
import { RealtimeHub } from './infrastructure/realtime/RealtimeHub.js';
import { KdsService } from './modules/kds/application/KdsService.js';
import { kdsRoutes } from './modules/kds/http/routes.js';
import { AuthService } from './modules/auth/application/AuthService.js';
import { AuthGuard, type AuthMode } from './modules/auth/http/AuthGuard.js';
import { authRoutes } from './modules/auth/http/routes.js';
import { AuditService } from './modules/audit/application/AuditService.js';
import { auditRoutes } from './modules/audit/http/routes.js';
import { TableService } from './modules/tables/application/TableService.js';
import { tableRoutes } from './modules/tables/http/routes.js';
import {
  HttpCloudSyncTransport,
  type CloudSyncTransport,
} from './modules/sync/HttpCloudSyncTransport.js';
import { SyncWorker } from './modules/sync/SyncWorker.js';
import { syncRoutes } from './modules/sync/routes.js';
import { createEdgeSecretStore, type EdgeSecretStore } from './modules/provisioning/EdgeSecretStore.js';
import { HttpControlTransport } from './modules/licensing/HttpControlTransport.js';
import { EdgeLicenseManager } from './modules/licensing/EdgeLicenseManager.js';
import { ControlStateWorker } from './modules/licensing/ControlStateWorker.js';
import { licensingRoutes } from './modules/licensing/routes.js';
import { DeviceService } from './modules/devices/DeviceService.js';
import { deviceRoutes } from './modules/devices/routes.js';

export interface BuildAppOptions {
  printerAdapter?: PrinterAdapter;
  startPrintWorker?: boolean;
  debugPrintDirectory?: string;
  authMode?: AuthMode;
  syncConfig?: EdgeSyncConfig;
  syncTransport?: CloudSyncTransport;
  startSyncWorker?: boolean;
  edgeSecretStore?: EdgeSecretStore;
  controlTransport?: HttpControlTransport;
  startControlWorker?: boolean;
}

export async function buildApp(dbPath: string = ':memory:', options: BuildAppOptions = {}) {
  const app = fastify({
    logger: true,
    logController: new LogController({
      disableRequestLogging: (request) => request.url === '/health',
    }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(websocket);

  // Initialize DB
  const db = initDatabase(dbPath);

  // Setup Repositories
  const catalogRepo = new CatalogRepository(db);
  const orderRepo = new OrderRepository(db);
  const cashRepo = new CashRepository(db);
  const printRepo = new PrintJobRepository(db);
  const kdsRepo = new KdsRepository(db);
  const authRepo = new AuthRepository(db);
  const auditRepo = new AuditRepository(db);
  const tableRepo = new TableRepository(db);
  const syncRepo = new SyncOutboxRepository(db);
  const controlRepo = new EdgeControlRepository(db);
  const deviceRepo = new DeviceRepository(db);
  const syncConfig = options.syncConfig ?? loadEdgeSyncConfig();
  const persistedIdentity = syncRepo.findIdentity();
  if (process.env['NODE_ENV'] === 'production' && !persistedIdentity) {
    throw new Error('Edge is UNPROVISIONED. Complete durable provisioning before starting the service.');
  }
  const edgeIdentity = persistedIdentity ?? syncRepo.ensureIdentity({
    configuredEdgeId: syncConfig.configuredEdgeId,
    tenantId: defaultOperationalContext.tenantId,
    locationId: defaultOperationalContext.locationId,
  });
  if ('provisioningState' in edgeIdentity && edgeIdentity.provisioningState !== 'ACTIVE') {
    throw new Error('Edge provisioning has not completed activation.');
  }
  const operationalContext = { ...defaultOperationalContext,
    tenantId: edgeIdentity.tenantId, locationId: edgeIdentity.locationId };

  const storedSecrets = syncConfig.enabled && !syncConfig.token
    ? await (options.edgeSecretStore ?? createEdgeSecretStore()).load()
    : null;
  const syncToken = syncConfig.token ?? storedSecrets?.active?.credential ?? null;
  if (syncConfig.enabled && !syncToken) throw new Error('Active provisioned Edge credential is unavailable.');
  const syncTransport =
    options.syncTransport ??
    (syncConfig.enabled && syncConfig.cloudUrl && syncToken
      ? new HttpCloudSyncTransport(
          syncConfig.cloudUrl,
          edgeIdentity.edgeId,
          syncToken,
          syncConfig.requestTimeoutMs,
        )
      : null);
  const controlTransport = options.controlTransport ??
    (syncConfig.licensing.enforcementEnabled && syncConfig.cloudUrl && syncToken
      ? new HttpControlTransport(syncConfig.cloudUrl, edgeIdentity.edgeId, syncToken,
          syncConfig.requestTimeoutMs) : null);
  const licenseManager = new EdgeLicenseManager(controlRepo, controlTransport,
    syncConfig.licensing, { tenantId: edgeIdentity.tenantId, locationId: edgeIdentity.locationId,
      edgeId: edgeIdentity.edgeId }, app.log);
  const controlWorker = new ControlStateWorker(licenseManager, syncConfig.licensing);
  const syncWorker = new SyncWorker(syncRepo, syncTransport, syncConfig, app.log,
    (revision) => licenseManager.noteDesiredRevision(revision));

  // Setup Services
  const catalogService = new CatalogService(catalogRepo);
  const realtimeHub = new RealtimeHub();
  const printService = new PrintService(printRepo, orderRepo, licenseManager);
  const kdsService = new KdsService(kdsRepo, tableRepo, realtimeHub, licenseManager);
  const orderService = new OrderService(orderRepo, catalogRepo, operationalContext,
    printService, kdsService, tableRepo, realtimeHub, licenseManager);
  const cashService = new CashService(cashRepo, printRepo, operationalContext, licenseManager);
  const paymentService = new PaymentService(orderRepo, cashRepo, auditRepo,
    operationalContext, realtimeHub, licenseManager);
  const authService = new AuthService(authRepo, operationalContext.tenantId,
    operationalContext.locationId);
  const authGuard = new AuthGuard(authService, options.authMode ?? 'enforced');
  const deviceService = new DeviceService(deviceRepo, licenseManager,
    { edgeId:edgeIdentity.edgeId,tenantId:operationalContext.tenantId,locationId:operationalContext.locationId },
    syncConfig.licensing.publicKeyring,app.log);
  const auditService = new AuditService(auditRepo);
  const tableService = new TableService(tableRepo, orderRepo, operationalContext);
  cashService.ensureDefaultRegister();
  const failingTargets = new Set(
    (process.env['COMANVIEW_DEBUG_PRINTER_FAIL_TARGETS'] ?? '').split(',').filter(Boolean),
  );
  const printerAdapter =
    options.printerAdapter ??
    new DebugPrinterAdapter({
      outputDirectory:
        options.debugPrintDirectory ??
        process.env['COMANVIEW_DEBUG_PRINT_DIR'] ??
        resolve('.comanview/print-debug'),
      failingTargetIds: failingTargets,
    });
  const printWorker = new PrintWorker(printRepo, printerAdapter);
  if (options.startPrintWorker !== false) printWorker.start();
  if (options.startSyncWorker !== false) syncWorker.start();
  if (options.startControlWorker !== false) controlWorker.start();

  // Setup Routes
  app.register(authRoutes(authService, authGuard), { prefix: '/auth' });
  app.register(catalogRoutes(catalogService, authGuard), { prefix: '/catalog' });
  app.register(orderRoutes(orderService, authGuard), { prefix: '/orders' });
  app.register(cashRoutes(cashService, authGuard), { prefix: '/cash-sessions' });
  app.register(paymentRoutes(paymentService, authGuard, authService));
  app.register(auditRoutes(auditService, authGuard));
  app.register(printRoutes(printService, authGuard));
  app.register(kdsRoutes(kdsService, realtimeHub, authGuard));
  app.register(tableRoutes(tableService, authGuard));
  app.register(syncRoutes(syncWorker, authGuard));
  app.register(licensingRoutes(licenseManager, authGuard));
  app.register(deviceRoutes(deviceService, authGuard));

  // Health route
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Basic check: is the DB queryable?
      let dbStatus: 'OK' | 'ERROR' = 'OK';
      try {
        catalogRepo.getAllCategories();
      } catch (err) {
        app.log.error({ err }, 'Database health check failed');
        dbStatus = 'ERROR';
      }

      const status = dbStatus === 'OK' ? 'UP' : 'DOWN';

      reply.send({
        status,
        edgeService: {
          status: 'OK',
          timestamp: new Date().toISOString(),
        },
        database: {
          status: dbStatus,
        },
      });
    },
  );

  app.addHook('onClose', async () => {
    printWorker.stop();
    syncWorker.stop();
    controlWorker.stop();
    closeDatabase();
  });

  return app;
}

// If executed directly, start the server
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const start = async () => {
    // Development default path for testing Edge
    const app = await buildApp(process.env['COMANVIEW_EDGE_DB_PATH'] ?? './edge-dev.db');
    try {
      await app.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  start();
}
