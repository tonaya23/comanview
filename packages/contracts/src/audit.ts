import { z } from 'zod';

export const AuditActionSchema = z.enum([
  'PAYMENT_VOIDED',
  'CASH_MOVEMENT_CREATED',
  'CASH_X_REPORT_GENERATED',
  'CASH_SESSION_CLOSED',
  'ORDER_EMPTY_CANCELLED',
  'LICENSE_RECOVERY_CASH_SESSION_OPENED',
  'DEVICE_PAIRING_CREATED','DEVICE_PAIRED','DEVICE_PAIRING_FAILED','DEVICE_PAIRING_RATE_LIMITED',
  'DEVICE_PAIRING_CANCELLED','DEVICE_REVOKED','FIRST_DEVICE_BOOTSTRAP_COMPLETED','DEVICE_LIMIT_EXCEEDED_ATTEMPT',
]);
export const AuditOutcomeSchema = z.enum(['SUCCESS','REJECTED']);
export const AuditEntityTypeSchema = z.enum([
  'PAYMENT',
  'CASH_MOVEMENT',
  'CASH_REPORT',
  'CASH_SESSION',
  'ORDER',
  'DEVICE','PAIRING','INSTALLATION',
]);

export const AuditEntrySchema = z.object({
  auditId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  deviceId: z.string().uuid().nullable(),
  sessionId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  actorType: z.enum(['USER','CLOUD_ADMIN_AUTHORIZATION','SYSTEM']),
  authorizationId: z.string().uuid().nullable(),
  source: z.string().nullable(),
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
