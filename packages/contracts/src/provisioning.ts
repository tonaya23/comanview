import { z } from 'zod';

const UuidSchema = z.string().uuid();
const CommandIdSchema = UuidSchema;
const SecretSchema = z.string().min(32).max(512);
const NameSchema = z.string().trim().min(1).max(160);

export const CloudTenantStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const CloudLocationConfigurationStatusSchema = z.enum(['COMPLETE', 'PENDING_CONFIGURATION']);
export const EdgeLifecycleStatusSchema = z.enum(['PROVISIONING', 'ACTIVE', 'REVOKED', 'REPLACED']);
export const EdgeCredentialStatusSchema = z.enum(['PENDING', 'ACTIVE', 'RETIRING', 'REVOKED']);

export const CloudTenantSchema = z.object({
  tenantId: UuidSchema,
  displayName: z.string().nullable(),
  status: CloudTenantStatusSchema,
  createdAt: z.string().datetime(),
});
export const CanonicalCloudLocationSchema = z.object({
  tenantId: UuidSchema,
  locationId: UuidSchema,
  displayName: z.string().nullable(),
  timezone: z.string().nullable(),
  status: CloudTenantStatusSchema,
  configurationStatus: CloudLocationConfigurationStatusSchema,
  createdAt: z.string().datetime(),
});
export const ProvisionedEdgeSchema = z.object({
  edgeId: UuidSchema,
  tenantId: UuidSchema,
  locationId: UuidSchema,
  status: EdgeLifecycleStatusSchema,
  provisionedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  replacedAt: z.string().datetime().nullable(),
  replacedByEdgeId: UuidSchema.nullable(),
});

export const CreateCloudTenantRequestSchema = z.object({
  commandId: CommandIdSchema,
  tenantId: UuidSchema.optional(),
  displayName: NameSchema,
});
export const CreateCloudLocationRequestSchema = z.object({
  commandId: CommandIdSchema,
  locationId: UuidSchema.optional(),
  displayName: NameSchema,
  timezone: z.string().trim().min(1).max(100),
});
export const CloudTenantListResponseSchema = z.object({ data: z.array(CloudTenantSchema) });
export const CanonicalCloudLocationListResponseSchema = z.object({ data: z.array(CanonicalCloudLocationSchema) });
export const ProvisionedEdgeListResponseSchema = z.object({ data: z.array(ProvisionedEdgeSchema) });

export const GenerateProvisioningCodeRequestSchema = z.object({ commandId: CommandIdSchema });
export const ProvisioningCodeSchema = z.object({
  provisioningCodeId: UuidSchema,
  tenantId: UuidSchema,
  locationId: UuidSchema,
  status: z.enum(['ISSUED', 'CONSUMED', 'REVOKED']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const GeneratedProvisioningCodeResponseSchema = ProvisioningCodeSchema.extend({
  code: SecretSchema,
});
export const RevokeProvisioningCodeRequestSchema = z.object({ commandId: CommandIdSchema });

export const ProvisioningExchangeRequestSchema = z.object({
  attemptId: UuidSchema,
  edgeId: UuidSchema,
  credentialId: UuidSchema,
  provisioningCode: SecretSchema,
  credential: SecretSchema,
});
export const ProvisioningExchangeResponseSchema = z.object({
  attemptId: UuidSchema,
  credentialId: UuidSchema,
  edge: ProvisionedEdgeSchema,
  replacement: z.boolean(),
});
export const ProvisioningActivateRequestSchema = z.object({
  commandId: CommandIdSchema,
  attemptId: UuidSchema,
  edgeId: UuidSchema,
});
export const ProvisioningActivateResponseSchema = z.object({ edge: ProvisionedEdgeSchema });

export const RevokeEdgeRequestSchema = z.object({
  commandId: CommandIdSchema,
  reason: z.string().trim().min(3).max(500),
});
export const InitiateEdgeReplacementRequestSchema = z.object({
  commandId: CommandIdSchema,
  oldEdgeId: UuidSchema,
  reason: z.string().trim().min(3).max(500),
});
export const InitiateEdgeReplacementResponseSchema = z.object({
  replacementId: UuidSchema,
  provisioningCode: GeneratedProvisioningCodeResponseSchema,
});
export const EdgeReplacementStatusSchema = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);
export const EdgeReplacementSchema = z.object({
  replacementId: UuidSchema,
  tenantId: UuidSchema,
  locationId: UuidSchema,
  oldEdgeId: UuidSchema,
  newEdgeId: UuidSchema.nullable(),
  status: EdgeReplacementStatusSchema,
  reason: z.string(),
  initiatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  provisioningCode: ProvisioningCodeSchema,
});
export const PendingEdgeReplacementResponseSchema = z.object({
  replacement: EdgeReplacementSchema.nullable(),
});
export const CancelEdgeReplacementRequestSchema = z.object({
  commandId: CommandIdSchema,
  reason: z.string().trim().min(3).max(500),
});

export const RegisterCredentialRotationRequestSchema = z.object({
  rotationId: UuidSchema,
  credentialId: UuidSchema,
  credential: SecretSchema,
});
export const CredentialRotationStatusSchema = z.object({
  rotationId: UuidSchema,
  credentialId: UuidSchema,
  status: EdgeCredentialStatusSchema,
  previousRetiresAt: z.string().datetime().nullable().optional(),
});
export const ConfirmCredentialRotationRequestSchema = z.object({
  commandId: CommandIdSchema,
  edgeId: UuidSchema,
});

export type CloudTenant = z.infer<typeof CloudTenantSchema>;
export type CanonicalCloudLocation = z.infer<typeof CanonicalCloudLocationSchema>;
export type ProvisionedEdge = z.infer<typeof ProvisionedEdgeSchema>;
export type EdgeReplacement = z.infer<typeof EdgeReplacementSchema>;
export type ProvisioningExchangeRequest = z.infer<typeof ProvisioningExchangeRequestSchema>;
export type ProvisioningExchangeResponse = z.infer<typeof ProvisioningExchangeResponseSchema>;
export type CredentialRotationStatus = z.infer<typeof CredentialRotationStatusSchema>;
