import { it, expect } from 'vitest';
import {
  CatalogChangedSchema,
  CatalogMutationPayloadSchema,
  CatalogBaselinePayloadSchema,
  canonicalCatalogJson,
} from './catalogPropagation.js';
import { OperationalRealtimeMessageSchema } from './realtime.js';
const id = '11111111-1111-4111-8111-111111111111';
it('catalog invalidation carries epoch/generation with bounded IDs and preserves operational compatibility', () => {
  const message = {
    type: 'CATALOG_CHANGED',
    locationId: id,
    capabilityVersion: 1,
    recoveryEpoch: 8,
    catalogGeneration: 3,
    affectedTypes: ['PRODUCT'],
    affectedIds: [id],
    fullInvalidation: false,
  };
  expect(OperationalRealtimeMessageSchema.parse(message)).toEqual(message);
  expect(
    CatalogChangedSchema.safeParse({ ...message, affectedIds: Array(101).fill(id) }).success,
  ).toBe(false);
});
it('projected values preserve exact Money and remove non-public fields', () => {
  const payload = {
    payloadVersion: 1,
    tenantId: id,
    locationId: id,
    edgeId: id,
    entityId: id,
    entityVersion: 2,
    catalogGeneration: 8,
    commandId: id,
    entities: [
      {
        entityType: 'PRODUCT',
        state: {
          id,
          name: 'Meal',
          description: '',
          productType: 'STANDARD',
          categoryId: id,
          sku: null,
          barcode: null,
          basePrice: { amount: 123, currency: 'MXN' },
          active: true,
          available: true,
          taxProfileId: id,
          taxProfileRevision: 2,
          stationId: null,
          displayOrder: 0,
          version: 2,
          credential: 'not public',
        },
      },
    ],
  };
  expect(JSON.stringify(CatalogMutationPayloadSchema.parse(payload))).not.toContain('credential');
  expect(CatalogMutationPayloadSchema.safeParse({ ...payload, entityVersion: 1.5 }).success).toBe(
    false,
  );
  payload.entities[0]!.state.basePrice.amount = Number.MAX_SAFE_INTEGER + 1;
  expect(CatalogMutationPayloadSchema.safeParse(payload).success).toBe(false);
});
it('baseline binds capture epoch, manifest and chunks with canonical JSON independent of key order', () => {
  const manifest = {
    payloadVersion: 1,
    tenantId: id,
    locationId: id,
    edgeId: id,
    sourceEpoch: 1,
    baselineId: 'a'.repeat(64),
    catalogGeneration: 0,
    chunkCount: 1,
    entityCount: 0,
    digest: 'b'.repeat(64),
    phase: 'CHUNK',
    chunkIndex: 0,
    entities: [],
  };
  expect(CatalogBaselinePayloadSchema.parse(manifest)).toEqual(manifest);
  expect(CatalogBaselinePayloadSchema.safeParse({ ...manifest, sourceEpoch: -1 }).success).toBe(
    false,
  );
  expect(canonicalCatalogJson({ b: 1, a: { z: 2, y: 3 } })).toBe(
    canonicalCatalogJson({ a: { y: 3, z: 2 }, b: 1 }),
  );
});
