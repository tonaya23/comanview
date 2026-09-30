import { z } from 'zod';

const id = z.string().uuid(),
  version = z.number().int().safe().positive();
const count = z.number().int().safe().nonnegative(),
  name = z.string().trim().min(1).max(200);
export const ModifierMoneySchema = z
  .object({ amount: z.number().int().safe(), currency: z.string().regex(/^[A-Z]{3}$/) })
  .strict();
export const CommercialModifierOptionSchema = z
  .object({
    id,
    groupId: id,
    version,
    name: z.string(),
    unitPriceDelta: ModifierMoneySchema,
    active: z.boolean(),
    available: z.boolean(),
    displayOrder: count,
  })
  .strict();
export const CommercialModifierGroupSchema = z
  .object({
    id,
    version,
    name: z.string(),
    minSelections: count,
    maxSelections: count,
    active: z.boolean(),
    options: z.array(CommercialModifierOptionSchema),
    products: z.array(z.object({ id, name: z.string(), active: z.boolean() })),
  })
  .strict();
export type CommercialModifierGroup = z.infer<typeof CommercialModifierGroupSchema>;
export type CommercialModifierOption = z.infer<typeof CommercialModifierOptionSchema>;
export const ModifierAdministrationSchema = z
  .object({
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    groups: z.array(CommercialModifierGroupSchema),
  })
  .strict();
export type ModifierAdministration = z.infer<typeof ModifierAdministrationSchema>;
export const ProductModifierAssignmentSchema = z
  .object({ groupId: id, displayOrder: count, overrides: z.record(id, ModifierMoneySchema) })
  .strict();
export const ProductModifierConfigurationSchema = z
  .object({
    productId: id,
    version,
    currency: z.string().regex(/^[A-Z]{3}$/),
    assignments: z.array(ProductModifierAssignmentSchema),
    groups: z.array(CommercialModifierGroupSchema),
  })
  .strict();
export type ProductModifierConfiguration = z.infer<typeof ProductModifierConfigurationSchema>;
export const ProductModifierCommandSchema = z
  .object({
    commandId: id,
    kind: z.literal('SET_PRODUCT_MODIFIERS'),
    entityId: id,
    expectedVersion: version,
    payload: z
      .object({
        assignments: z
          .array(ProductModifierAssignmentSchema.extend({ groupVersion: version }))
          .max(100),
      })
      .strict(),
  })
  .strict();
export type ProductModifierCommand = z.infer<typeof ProductModifierCommandSchema>;
const base = { commandId: id },
  existing = { ...base, entityId: id, expectedVersion: version };
const groupRef = z.object({ id, version }).strict();
const groupPayload = z
  .object({ name, minSelections: count, maxSelections: count, active: z.boolean() })
  .strict();
const optionPayload = z
  .object({
    name,
    unitPriceDelta: ModifierMoneySchema,
    active: z.boolean(),
    available: z.boolean(),
    displayOrder: count,
  })
  .strict();
export const ModifierCommandObjects = [
  z
    .object({
      ...base,
      kind: z.literal('CREATE_MODIFIER_GROUP'),
      expectedVersion: z.literal(0),
      payload: groupPayload,
    })
    .strict(),
  z
    .object({ ...existing, kind: z.literal('UPDATE_MODIFIER_GROUP'), payload: groupPayload })
    .strict(),
  z
    .object({
      ...existing,
      kind: z.literal('SET_MODIFIER_GROUP_ACTIVE'),
      payload: z.object({ active: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('CREATE_MODIFIER_OPTION'),
      expectedVersion: z.literal(0),
      group: groupRef,
      payload: optionPayload,
    })
    .strict(),
  z
    .object({
      ...existing,
      kind: z.literal('UPDATE_MODIFIER_OPTION'),
      group: groupRef,
      payload: optionPayload,
    })
    .strict(),
  z
    .object({
      ...existing,
      kind: z.literal('SET_MODIFIER_OPTION_ACTIVE'),
      group: groupRef,
      payload: z.object({ active: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...existing,
      kind: z.literal('SET_MODIFIER_OPTION_AVAILABILITY'),
      group: groupRef,
      payload: z.object({ available: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...existing,
      kind: z.literal('REORDER_MODIFIER_OPTIONS'),
      payload: z
        .object({
          options: z
            .array(z.object({ id, expectedVersion: version, displayOrder: count }).strict())
            .min(1)
            .max(1000),
        })
        .strict(),
    })
    .strict(),
] as const;
export const ModifierCommandSchema = z.discriminatedUnion('kind', ModifierCommandObjects);
export type ModifierCommand = z.infer<typeof ModifierCommandSchema>;
export function isModifierCommand(command: { kind: string }): command is ModifierCommand {
  return ModifierCommandObjects.some((schema) => schema.shape.kind.value === command.kind);
}
