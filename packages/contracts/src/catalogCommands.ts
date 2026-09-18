import { z } from 'zod';

const id = z.string().uuid(),
  version = z.number().int().positive().safe();
const name = z.string().trim().min(1).max(200);
const text = z.string().trim().max(4000);
const key = z.string().max(200).nullable();
const order = z.number().int().nonnegative().safe();
const money = z
  .object({
    amount: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
const reference = z.object({ id, version }).strict();
const base = { commandId: id };
const product = { ...base, entityId: id, expectedVersion: version };
export const CatalogCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('CREATE_PRODUCT'),
      expectedVersion: z.literal(0),
      payload: z
        .object({
          name,
          description: text.default(''),
          category: reference.optional(),
          sku: key.default(null),
          barcode: key.default(null),
          basePrice: money,
          taxProfile: reference.optional(),
          station: reference.nullable().default(null),
          displayOrder: order.default(0),
          active: z.boolean().default(true),
          available: z.boolean().default(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('UPDATE_PRODUCT_DETAILS'),
      payload: z
        .object({ name, description: text, sku: key, barcode: key, displayOrder: order })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('SET_PRODUCT_ACTIVE'),
      payload: z.object({ active: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('SET_PRODUCT_AVAILABILITY'),
      payload: z.object({ available: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('ASSIGN_PRODUCT_CATEGORY'),
      payload: z.object({ category: reference }).strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('UPDATE_PRODUCT_PRICE'),
      reason: z.string().trim().min(1).max(500),
      payload: z.object({ basePrice: money }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('CREATE_CATEGORY'),
      expectedVersion: z.literal(0),
      payload: z.object({ name, displayOrder: order.default(0) }).strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('UPDATE_CATEGORY'),
      payload: z.object({ name }).strict(),
    })
    .strict(),
  z
    .object({
      ...product,
      kind: z.literal('SET_CATEGORY_ACTIVE'),
      payload: z.object({ active: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('REORDER_CATEGORIES'),
      payload: z
        .object({
          categories: z
            .array(z.object({ id, expectedVersion: version, displayOrder: order }).strict())
            .min(1)
            .max(1000),
        })
        .strict(),
    })
    .strict(),
]);
export type CatalogCommand = z.infer<typeof CatalogCommandSchema>;
export type CatalogCommandInput = z.input<typeof CatalogCommandSchema>;
export const CommercialCategorySchema = z
  .object({
    id,
    name: z.string(),
    active: z.boolean(),
    displayOrder: order,
    version,
    systemKey: z.literal('UNCATEGORIZED').nullable(),
  })
  .strict();
export const CommercialProductSchema = z
  .object({
    id,
    name: z.string(),
    description: z.string(),
    categoryId: id,
    sku: z.string().nullable(),
    barcode: z.string().nullable(),
    basePrice: money,
    taxProfileId: id,
    taxProfileRevision: version.nullable(),
    stationId: id.nullable(),
    displayOrder: order,
    active: z.boolean(),
    available: z.boolean(),
    version,
  })
  .strict();
export const CatalogCommandResultSchema = z
  .object({
    commandId: id,
    entityType: z.enum(['PRODUCT', 'CATEGORY', 'CATEGORIES']),
    entityId: id.nullable(),
    version: version.nullable(),
    catalogGeneration: z.number().int().nonnegative().safe(),
    recoveryEpoch: z.number().int().nonnegative().safe(),
    changed: z.boolean(),
    entities: z.array(z.union([CommercialProductSchema, CommercialCategorySchema])),
  })
  .strict();
export type CatalogCommandResult = z.infer<typeof CatalogCommandResultSchema>;

export const ProductAssignmentResultFields = {
  catalogGeneration: z.number().int().nonnegative().safe().optional(),
  changed: z.boolean().optional(),
  recoveryEpoch: z.number().int().nonnegative().safe().optional(),
  reference: z
    .object({
      kind: z.enum(['TAX_PROFILE', 'STATION']),
      id: z.string().uuid().nullable(),
      version: z.number().int().positive().safe().nullable(),
    })
    .strict()
    .optional(),
};
