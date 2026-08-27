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
} from '@comanview/database';
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

export interface BuildAppOptions {
  printerAdapter?: PrinterAdapter;
  startPrintWorker?: boolean;
  debugPrintDirectory?: string;
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

  // Setup Services
  const catalogService = new CatalogService(catalogRepo);
  const printService = new PrintService(printRepo, orderRepo);
  const realtimeHub = new RealtimeHub();
  const kdsService = new KdsService(kdsRepo, realtimeHub);
  const orderService = new OrderService(
    orderRepo,
    catalogRepo,
    defaultOperationalContext,
    printService,
    kdsService,
  );
  const cashService = new CashService(cashRepo, defaultOperationalContext);
  const paymentService = new PaymentService(orderRepo, cashRepo, defaultOperationalContext);
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

  // Setup Routes
  app.register(catalogRoutes(catalogService), { prefix: '/catalog' });
  app.register(orderRoutes(orderService), { prefix: '/orders' });
  app.register(cashRoutes(cashService), { prefix: '/cash-sessions' });
  app.register(paymentRoutes(paymentService));
  app.register(printRoutes(printService));
  app.register(kdsRoutes(kdsService, realtimeHub));

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
