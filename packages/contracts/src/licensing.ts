import { z } from 'zod';

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();

export const CapabilityCodeSchema = z.enum([
  'CORE_POS',
  'TABLE_SERVICE',
  'KDS',
  'PRINTING',
  'PUBLIC_STOREFRONT',
  'INVENTORY',
  'MULTI_LOCATION',
]);

export const LicenseDeclaredStateSchema = z.enum([
  'ACTIVE',
  'PAST_DUE',
  'GRACE_PERIOD',
  'SUSPENDED',
  'TERMINATED',
]);

export const SignedDocumentTypeSchema = z.enum(['LICENSE', 'FEATURE_FLAGS', 'CONFIGURATION']);
export const SignedDocumentProtectedHeaderSchema = z.object({
  typ: SignedDocumentTypeSchema,
  formatVersion: z.literal(1),
  alg: z.literal('EdDSA'),
  kid: z.string().trim().min(1).max(120),
});
export const SignedDocumentEnvelopeSchema = z.object({
  protected: z.string().min(1),
  payload: z.string().min(1),
  signature: z.string().min(1),
});

const DocumentIdentitySchema = z.object({
  formatVersion: z.literal(1),
  documentId: UuidSchema,
  revision: z.number().int().positive(),
  tenantId: UuidSchema,
  locationId: UuidSchema,
  edgeId: UuidSchema,
  issuedAt: TimestampSchema,
});

export const LicenseDocumentPayloadSchema = DocumentIdentitySchema.extend({
  documentType: z.literal('LICENSE'),
  declaredState: LicenseDeclaredStateSchema,
  planCode: z.string().trim().min(1).max(120),
  capabilities: z.array(CapabilityCodeSchema).max(100),
  deviceLimits: z.object({
    POS: z.number().int().nonnegative().nullable(),
    WAITER: z.number().int().nonnegative().nullable(),
    KDS: z.number().int().nonnegative().nullable(),
  }).optional(),
  expiresAt: TimestampSchema,
  graceUntil: TimestampSchema,
});
export const DeviceLimitsSchema = z.object({
  POS: z.number().int().nonnegative().nullable(),
  WAITER: z.number().int().nonnegative().nullable(),
  KDS: z.number().int().nonnegative().nullable(),
});
export type DeviceLimits = z.infer<typeof DeviceLimitsSchema>;

export const FeatureFlagsDocumentPayloadSchema = DocumentIdentitySchema.extend({
  documentType: z.literal('FEATURE_FLAGS'),
  flags: z.record(z.string().min(1).max(120), z.boolean()),
});

export const EdgeConfigurationPayloadSchema = z.object({
  payment: z.object({
    tipsEnabled: z.boolean(),
    tipPercentageOptionsBasisPoints: z.array(z.number().int().min(0).max(10_000)).max(12),
  }),
});

export const ConfigurationDocumentPayloadSchema = DocumentIdentitySchema.extend({
  documentType: z.literal('CONFIGURATION'),
  configuration: EdgeConfigurationPayloadSchema,
});

export const ControlDocumentSchema = z.object({
  revision: z.number().int().positive(),
  envelope: SignedDocumentEnvelopeSchema,
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const EdgeControlStateResponseSchema = z.object({
  desiredControlRevision: z.number().int().nonnegative(),
  cloudTime: TimestampSchema,
  license: ControlDocumentSchema.nullable(),
  featureFlags: ControlDocumentSchema.nullable(),
  configuration: ControlDocumentSchema.nullable(),
});
export const EdgeControlAckRequestSchema = z.object({
  commandId: UuidSchema,
  stream: SignedDocumentTypeSchema,
  revision: z.number().int().positive(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  appliedAt: TimestampSchema,
});

export const EffectiveLicenseModeSchema = z.enum([
  'FULL',
  'FULL_WITH_WARNING',
  'GRACE_OPERATING',
  'GUARANTEED_SHIFT',
  'GUARANTEED_SHIFT_RECOVERY',
  'PROTECTED_OPERATIONS',
  'POST_GRACE_BLOCKED',
  'SUSPENDED_BLOCKED',
  'TERMINATED_BLOCKED',
  'NO_VALID_LICENSE',
  'CLOCK_SUSPECT',
]);

export const EffectiveCapabilitiesResponseSchema = z.object({
  mode: EffectiveLicenseModeSchema,
  declaredState: LicenseDeclaredStateSchema.nullable(),
  capabilities: z.array(CapabilityCodeSchema),
  deviceLimits: DeviceLimitsSchema.optional(),
  licenseRevision: z.number().int().positive().nullable(),
  featureFlagsRevision: z.number().int().positive().nullable(),
  configurationRevision: z.number().int().positive().nullable(),
  cloudReachable: z.boolean(),
  expiresAt: TimestampSchema.nullable(),
  graceUntil: TimestampSchema.nullable(),
  reasonCode: z.string(),
  protectedOrderCount: z.number().int().nonnegative(),
  clockStatus: z.enum(['TRUSTED', 'ROLLBACK_DETECTED', 'FORWARD_JUMP_DETECTED']),
});

export const CloudPlanSchema = z.object({
  planId: UuidSchema,
  code: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(160),
  active: z.boolean(),
  capabilities: z.array(CapabilityCodeSchema),
  deviceLimits: DeviceLimitsSchema.nullable(),
  revision: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const CreateCloudPlanRequestSchema = z.object({
  commandId: UuidSchema,
  code: z.string().trim().min(1).max(120).regex(/^[A-Z0-9_-]+$/),
  displayName: z.string().trim().min(1).max(160),
  capabilities: z.array(CapabilityCodeSchema),
  deviceLimits: DeviceLimitsSchema,
  reason: z.string().trim().min(3).max(500),
});
export const CloudPlanListResponseSchema = z.object({ data: z.array(CloudPlanSchema) });

export const LocationLicenseAssignmentSchema = z.object({
  tenantId: UuidSchema,
  locationId: UuidSchema,
  planId: UuidSchema,
  planCode: z.string(),
  declaredState: LicenseDeclaredStateSchema,
  revision: z.number().int().positive(),
  capabilities: z.array(CapabilityCodeSchema),
  deviceLimits: DeviceLimitsSchema.nullable(),
  configuration: EdgeConfigurationPayloadSchema,
  configurationRevision: z.number().int().positive(),
  updatedAt: TimestampSchema,
});
export const AssignLocationLicenseRequestSchema = z.object({
  commandId: UuidSchema,
  expectedRevision: z.number().int().nonnegative().default(0),
  planId: UuidSchema,
  declaredState: LicenseDeclaredStateSchema.default('ACTIVE'),
  configuration: EdgeConfigurationPayloadSchema,
  reason: z.string().trim().min(3).max(500),
});
export const UpdateLocationLicenseStateRequestSchema = z.object({
  commandId: UuidSchema,
  expectedRevision: z.number().int().positive(),
  declaredState: LicenseDeclaredStateSchema,
  reason: z.string().trim().min(3).max(500),
});
export const UpdateLocationConfigurationRequestSchema = z.object({
  commandId: UuidSchema,
  expectedRevision: z.number().int().positive(),
  configuration: EdgeConfigurationPayloadSchema,
  reason: z.string().trim().min(3).max(500),
});

export type CapabilityCode = z.infer<typeof CapabilityCodeSchema>;
export type LicenseDeclaredState = z.infer<typeof LicenseDeclaredStateSchema>;
export type SignedDocumentEnvelope = z.infer<typeof SignedDocumentEnvelopeSchema>;
export type LicenseDocumentPayload = z.infer<typeof LicenseDocumentPayloadSchema>;
export type FeatureFlagsDocumentPayload = z.infer<typeof FeatureFlagsDocumentPayloadSchema>;
export type ConfigurationDocumentPayload = z.infer<typeof ConfigurationDocumentPayloadSchema>;
export type EdgeConfiguration = z.infer<typeof EdgeConfigurationPayloadSchema>;
export type EffectiveLicenseMode = z.infer<typeof EffectiveLicenseModeSchema>;
export type EffectiveCapabilitiesResponse = z.infer<typeof EffectiveCapabilitiesResponseSchema>;
export type CloudPlan = z.infer<typeof CloudPlanSchema>;
export type LocationLicenseAssignment = z.infer<typeof LocationLicenseAssignmentSchema>;
