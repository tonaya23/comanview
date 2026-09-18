import { z } from 'zod';
const integer = z.number().int().safe().nonnegative();
const version = integer.positive();
const binding = {
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  edgeId: z.string().uuid(),
};
export const CatalogStateSchema = z.object({
  recoveryEpoch: integer,
  catalogGeneration: integer,
  capabilityVersion: z.literal(1),
});
export type CatalogState = z.infer<typeof CatalogStateSchema>;
export const CatalogChangedSchema = CatalogStateSchema.extend({
  type: z.literal('CATALOG_CHANGED'),
  locationId: z.string().uuid(),
  affectedTypes: z.array(z.enum(['PRODUCT', 'CATEGORY'])).max(2),
  affectedIds: z.array(z.string().uuid()).max(100),
  fullInvalidation: z.boolean(),
});
export type CatalogChanged = z.infer<typeof CatalogChangedSchema>;
export const CatalogProjectedCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
  displayOrder: z.number().int().safe(),
  systemKey: z.literal('UNCATEGORIZED').nullable(),
  version,
});
export const CatalogProjectedProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  productType: z.enum(['STANDARD', 'RECIPE', 'NON_INVENTORY']),
  categoryId: z.string().uuid(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  basePrice: z.object({ amount: integer, currency: z.string().regex(/^[A-Z]{3}$/) }),
  active: z.boolean(),
  available: z.boolean(),
  taxProfileId: z.string().uuid(),
  taxProfileRevision: version.nullable(),
  stationId: z.string().uuid().nullable(),
  displayOrder: z.number().int().safe(),
  version,
});
export const CatalogProjectedEntitySchema = z.discriminatedUnion('entityType', [
  z.object({ entityType: z.literal('PRODUCT'), state: CatalogProjectedProductSchema }),
  z.object({ entityType: z.literal('CATEGORY'), state: CatalogProjectedCategorySchema }),
]);
export type CatalogProjectedEntity = z.infer<typeof CatalogProjectedEntitySchema>;
export const CatalogMutationTypes = [
  'CATALOG_PRODUCT_CREATED',
  'CATALOG_PRODUCT_UPDATED',
  'CATALOG_PRODUCT_STATUS_CHANGED',
  'CATALOG_PRODUCT_PRICE_CHANGED',
  'CATALOG_PRODUCT_TAX_ASSIGNED',
  'CATALOG_PRODUCT_STATION_ASSIGNED',
  'CATALOG_CATEGORY_CREATED',
  'CATALOG_CATEGORY_UPDATED',
  'CATALOG_CATEGORY_STATUS_CHANGED',
  'CATALOG_CATEGORY_REORDERED',
] as const;
export const CatalogMutationPayloadSchema = z.object({
  payloadVersion: z.literal(1),
  ...binding,
  entityId: z.string().uuid(),
  entityVersion: version,
  catalogGeneration: integer,
  commandId: z.string().min(1).max(120),
  entities: z.array(CatalogProjectedEntitySchema).min(1).max(1000),
});
export type CatalogMutationPayload = z.infer<typeof CatalogMutationPayloadSchema>;
const manifest = {
  payloadVersion: z.literal(1),
  ...binding,
  sourceEpoch: integer,
  baselineId: z.string().regex(/^[a-f0-9]{64}$/),
  catalogGeneration: integer,
  chunkCount: version,
  entityCount: integer,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
};
export const CatalogBaselinePayloadSchema = z.discriminatedUnion('phase', [
  z.object({ ...manifest, phase: z.literal('STARTED') }),
  z.object({
    ...manifest,
    phase: z.literal('CHUNK'),
    chunkIndex: integer,
    entities: z.array(CatalogProjectedEntitySchema).max(100),
  }),
  z.object({ ...manifest, phase: z.literal('COMPLETED') }),
]);
export type CatalogBaselinePayload = z.infer<typeof CatalogBaselinePayloadSchema>;

// Stable encoding shared by Edge capture and Cloud verification, independent of JSONB key order.
export function canonicalCatalogJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}
