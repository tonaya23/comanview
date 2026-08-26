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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { initDatabase, closeDatabase } from './infrastructure/database.js';
import { errorHandler } from './app/errorHandler.js';
import { CashRepository, CatalogRepository, OrderRepository } from '@comanview/database';
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

export async function buildApp(dbPath: string = ':memory:') {
  const app = fastify({
    logger: true,
    logController: new LogController({
      disableRequestLogging: (request) => request.url === '/health',
    }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // Initialize DB
  const db = initDatabase(dbPath);

  // Setup Repositories
  const catalogRepo = new CatalogRepository(db);
  const orderRepo = new OrderRepository(db);
  const cashRepo = new CashRepository(db);

  // Setup Services
  const catalogService = new CatalogService(catalogRepo);
  const orderService = new OrderService(orderRepo, catalogRepo, defaultOperationalContext);
  const cashService = new CashService(cashRepo, defaultOperationalContext);
  const paymentService = new PaymentService(orderRepo, cashRepo, defaultOperationalContext);
  cashService.ensureDefaultRegister();

  // Setup Routes
  app.register(catalogRoutes(catalogService), { prefix: '/catalog' });
  app.register(orderRoutes(orderService), { prefix: '/orders' });
  app.register(cashRoutes(cashService), { prefix: '/cash-sessions' });
  app.register(paymentRoutes(paymentService));

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
    closeDatabase();
  });

  return app;
}

// If executed directly, start the server
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const start = async () => {
    // Development default path for testing Edge
    const app = await buildApp('./edge-dev.db');
    try {
      await app.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  start();
}
