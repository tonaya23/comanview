import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CatalogService } from '../application/CatalogService.js';
import {
  CreateProductRequestSchema,
  SetProductAvailabilityRequestSchema,
} from '@comanview/contracts';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';
import { actorFrom } from '../../auth/http/AuthGuard.js';
import { CatalogCommandSchema,CatalogStateSchema } from '@comanview/contracts';
import type { CatalogCommandService } from '../application/CatalogCommandService.js';
import { AppError } from '../../../app/errorHandler.js';

export function catalogRoutes(
  catalogService: CatalogService,
  auth: AuthGuard,
  commands: CatalogCommandService,
): FastifyPluginAsyncZod {
  return async (fastify) => {
    fastify.get('/state',{preHandler:auth.requirePermission(PERMISSIONS.CATALOG_VIEW),schema:{response:{200:CatalogStateSchema}}},()=>commands.state());
    fastify.post('/commands',{preHandler:auth.requirePermission(PERMISSIONS.CATALOG_MANAGE),schema:{body:CatalogCommandSchema}},
      request=>commands.execute(request.body,actorFrom(request)));
    // POST /catalog/products
    fastify.post(
      '/products',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CATALOG_MANAGE),
        schema: {
          body: CreateProductRequestSchema,
        },
      },
      async (request, reply) => {
        throw new AppError('CLIENT_CAPABILITY_REQUIRED',409,'Actualiza el cliente para enviar comandos de catálogo con control de versión.');
      },
    );

    // GET /catalog/products
    fastify.get(
      '/products',
      { preHandler: auth.requirePermission(PERMISSIONS.CATALOG_VIEW) },
      async (request, reply) => {
        const products = await catalogService.getAllProducts();
        reply.send(products);
      },
    );

    // GET /catalog/categories
    fastify.get(
      '/categories',
      { preHandler: auth.requirePermission(PERMISSIONS.CATALOG_VIEW) },
      async (request, reply) => {
        const categories = await catalogService.getAllCategories();
        reply.send(categories);
      },
    );

    // GET /catalog/products/:id
    fastify.get(
      '/products/:id',
      { preHandler: auth.requirePermission(PERMISSIONS.CATALOG_VIEW) },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const product = await catalogService.getProduct(id);

        if (!product) {
          reply.status(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
          return;
        }

        reply.send(product);
      },
    );

    // PATCH /catalog/products/:id/availability
    fastify.patch(
      '/products/:id/availability',
      {
        preHandler: auth.requirePermission(PERMISSIONS.CATALOG_MANAGE),
        schema: {
          body: SetProductAvailabilityRequestSchema,
        },
      },
      async (request, reply) => {
        throw new AppError('CLIENT_CAPABILITY_REQUIRED',409,'Actualiza el cliente para enviar comandos de catálogo con control de versión.');
      },
    );
  };
}
