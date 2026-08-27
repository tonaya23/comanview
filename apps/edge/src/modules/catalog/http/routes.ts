import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CatalogService } from '../application/CatalogService.js';
import {
  CreateProductRequestSchema,
  SetProductAvailabilityRequestSchema,
  type CreateProductRequest,
  type SetProductAvailabilityRequest,
} from '@comanview/contracts';
import { PERMISSIONS } from '@comanview/auth';
import type { AuthGuard } from '../../auth/http/AuthGuard.js';

export function catalogRoutes(
  catalogService: CatalogService,
  auth: AuthGuard,
): FastifyPluginAsyncZod {
  return async (fastify) => {
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
        const body = request.body as CreateProductRequest;
        const product = await catalogService.createProduct(body);
        reply.status(201).send(product);
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
        const { id } = request.params as { id: string };
        const body = request.body as SetProductAvailabilityRequest;
        const product = await catalogService.setProductAvailability(id, body);

        if (!product) {
          reply.status(404).send({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
          return;
        }

        reply.send(product);
      },
    );
  };
}
