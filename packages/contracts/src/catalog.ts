import { z } from 'zod';

// Money structure
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3),
});

// Category
export const CategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
});

export type CategoryResponse = z.infer<typeof CategorySchema>;

// Tax Profile
export const TaxProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  rateBasisPoints: z.number().int(),
  calculationMode: z.enum(['TAX_INCLUDED', 'TAX_ADDED']),
  active: z.boolean(),
});

// Modifier Option
export const ModifierOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  defaultPriceDelta: MoneySchema,
  active: z.boolean(),
  available: z.boolean(),
  displayOrder: z.number().int(),
});

// Modifier Group
export const ModifierGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  minSelections: z.number().int(),
  maxSelections: z.number().int(),
  active: z.boolean(),
  options: z.array(ModifierOptionSchema),
});

// Product Modifier Group
export const ProductModifierGroupSchema = z.object({
  modifierGroup: ModifierGroupSchema,
  priceDeltaOverrides: z.record(z.string().uuid(), MoneySchema),
});

// Product
export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  productType: z.enum(['STANDARD', 'RECIPE', 'NON_INVENTORY']),
  categoryId: z.string().uuid().nullable(),
  taxProfile: TaxProfileSchema,
  basePrice: MoneySchema,
  stationId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  displayOrder: z.number().int(),
  active: z.boolean(),
  available: z.boolean(),
  modifierGroups: z.array(ProductModifierGroupSchema),
});

export type ProductResponse = z.infer<typeof ProductSchema>;

// Requests
export const CreateProductRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  productType: z.enum(['STANDARD', 'RECIPE', 'NON_INVENTORY']).default('STANDARD'),
  categoryId: z.string().uuid().optional(),
  taxProfileId: z.string().uuid(),
  basePrice: MoneySchema,
  stationId: z.string().uuid().optional(),
});

export type CreateProductRequest = z.infer<typeof CreateProductRequestSchema>;

export const SetProductAvailabilityRequestSchema = z.object({
  available: z.boolean(),
});

export type SetProductAvailabilityRequest = z.infer<typeof SetProductAvailabilityRequestSchema>;
