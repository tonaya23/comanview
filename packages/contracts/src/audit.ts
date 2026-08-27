import { z } from 'zod';

export const AuditActionSchema = z.enum([
  'PAYMENT_VOIDED',
  'CASH_MOVEMENT_CREATED',
  'CASH_X_REPORT_GENERATED',
  'CASH_SESSION_CLOSED',
]);
export const AuditOutcomeSchema = z.enum(['SUCCESS']);
export const AuditEntityTypeSchema = z.enum(['PAYMENT', 'CASH_MOVEMENT', 'CASH_REPORT', 'CASH_SESSION']);

export const AuditEntrySchema = z.object({
  auditId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorRole: z.string().nullable(),
  authorizedByUserId: z.string().uuid().nullable(),
  authorizedByRole: z.string().nullable(),
  action: AuditActionSchema,
  entityType: AuditEntityTypeSchema,
  entityId: z.string().uuid(),
  outcome: AuditOutcomeSchema,
  reason: z.string(),
  commandId: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  amountAffected: z.number().int().nullable(),
  currency: z.string().nullable(),
  eventId: z.string().uuid().nullable(),
  previousHash: z.string().nullable(),
  entryHash: z.string(),
});

export const AuditListQuerySchema = z.object({
  action: AuditActionSchema.optional(),
  actorUserId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const AuditListResponseSchema = z.object({ entries: z.array(AuditEntrySchema) });

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditEntityType = z.infer<typeof AuditEntityTypeSchema>;
export type AuditEntryResponse = z.infer<typeof AuditEntrySchema>;
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
