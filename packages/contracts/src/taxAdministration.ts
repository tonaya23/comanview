import { z } from 'zod';

const Command = z.object({ commandId: z.string().min(1).max(120), expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500) });
const TaxFields = { name: z.string().trim().min(1).max(100), rateBasisPoints: z.number().int().safe().nonnegative(),
  calculationMode: z.enum(['TAX_ADDED', 'TAX_INCLUDED']) };
export const TaxAdministrationCommandSchema = z.discriminatedUnion('kind', [
  Command.extend({ kind: z.literal('CREATE_TAX_PROFILE'), ...TaxFields }).strict(),
  Command.extend({ kind: z.literal('REVISE_TAX_PROFILE'), profileId: z.string().uuid(), ...TaxFields }).strict(),
  Command.extend({ kind: z.literal('DEACTIVATE_TAX_PROFILE'), profileId: z.string().uuid() }).strict(),
  Command.extend({ kind: z.literal('SET_DEFAULT_TAX_PROFILE'), profileId: z.string().uuid() }).strict(),
  Command.extend({ kind: z.literal('ASSIGN_PRODUCT_TAX_PROFILE'), profileId: z.string().uuid(), productId: z.string().uuid() }).strict(),
]);
export type TaxAdministrationCommand = z.infer<typeof TaxAdministrationCommandSchema>;
export const TaxAdministrationResultSchema = z.object({ entityId: z.string().uuid(), version: z.number().int().positive() });
export type TaxAdministrationResult = z.infer<typeof TaxAdministrationResultSchema>;
export const TaxAdministrationStateSchema=z.object({fiscalPolicyVersion:z.number().int().nonnegative(),defaultTaxProfileId:z.string().uuid().nullable(),configurationVersion:z.number().int().positive(),
  profiles:z.array(z.object({id:z.string().uuid(),name:z.string(),rateBasisPoints:z.number().int().nonnegative(),calculationMode:z.enum(['TAX_ADDED','TAX_INCLUDED']),active:z.boolean(),version:z.number().int().positive()})),
  products:z.array(z.object({id:z.string().uuid(),name:z.string(),taxProfileId:z.string().uuid(),taxProfileRevision:z.number().int().positive().nullable(),version:z.number().int().positive()}))});
export type TaxAdministrationState=z.infer<typeof TaxAdministrationStateSchema>;
