import { z } from 'zod';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime();
export const DeviceTypeSchema = z.enum(['POS', 'WAITER', 'KDS']);
export const DeviceStatusSchema = z.enum(['PENDING', 'ACTIVE', 'REVOKED']);
export const PairingStatusSchema = z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED']);
export const DeviceSchema = z.object({
  deviceId: Uuid, displayName: z.string().min(1).max(120), type: DeviceTypeSchema,
  status: DeviceStatusSchema, createdAt: Timestamp, activatedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
});
export const CreatePairingRequestSchema = z.object({
  deviceId: Uuid, deviceType: DeviceTypeSchema, displayName: z.string().trim().min(1).max(120),
  credential: z.string().min(43).max(512),
});
export const PairingCreatedSchema = z.object({
  pairingId: Uuid, requestToken: z.string().min(43), pairingCode: z.string().regex(/^\d{6}$/),
  device: DeviceSchema, expiresAt: Timestamp,
});
export const PairingStatusResponseSchema = z.object({
  pairingId: Uuid, status: PairingStatusSchema, device: DeviceSchema, expiresAt: Timestamp,
});
export const PairingAuthorizationDataSchema = z.object({
  schemaVersion: z.literal(1),
  pairingId: Uuid,
  pairingCode: z.string().regex(/^\d{6}$/),
  deviceId: Uuid,
  deviceType: DeviceTypeSchema,
  displayName: z.string().trim().min(1).max(120),
}).strict();
export const ApprovePairingRequestSchema = z.object({
  commandId: Uuid, pairingId: Uuid, pairingCode: z.string().regex(/^\d{6}$/),
});
export const RevokeDeviceRequestSchema = z.object({
  commandId: Uuid, reason: z.string().trim().min(3).max(500),
});
export const CancelPairingRequestSchema = z.object({ commandId: Uuid });
export const DeviceListResponseSchema = z.object({ data: z.array(DeviceSchema) });
export const PairingListResponseSchema = z.object({ data: z.array(PairingStatusResponseSchema) });

export const InstallationAuthorizationPayloadSchema = z.object({
  formatVersion: z.literal(1), typ: z.literal('comanview-installation-authorization'),
  authorizationId: Uuid, tenantId: Uuid, locationId: Uuid, edgeId: Uuid,
  pairingId: Uuid, pairingCodeHash: z.string().regex(/^[a-f0-9]{64}$/), deviceId: Uuid,
  deviceType: DeviceTypeSchema, displayName: z.string().min(1).max(120),
  initialOwnerId: Uuid, initialOwnerDisplayName: z.string().min(1).max(120),
  issuedAt: Timestamp, expiresAt: Timestamp,
});
export const InstallationAuthorizationEnvelopeSchema = z.object({
  protected: z.string().min(1), payload: z.string().min(1), signature: z.string().min(1),
});
export const IssueInstallationAuthorizationRequestSchema = z.object({
  commandId: Uuid, pairingId: Uuid, pairingCode: z.string().regex(/^\d{6}$/), deviceId: Uuid,
  deviceType: DeviceTypeSchema, displayName: z.string().trim().min(1).max(120),
  initialOwnerDisplayName: z.string().trim().min(1).max(120), reason: z.string().trim().min(3).max(500),
});
export const IssuedInstallationAuthorizationSchema = z.object({
  authorizationId:Uuid,status:z.enum(['ISSUED','CONSUMED','EXPIRED','REVOKED']),expiresAt:Timestamp,
  authorization:InstallationAuthorizationEnvelopeSchema,
});
export const InstallationAuthorizationStatusSchema = z.object({
  authorizationId:Uuid,status:z.enum(['ISSUED','CONSUMED','EXPIRED','REVOKED']),
  issuedAt:Timestamp,expiresAt:Timestamp,consumedAt:Timestamp.nullable(),
});
export const LatestInstallationAuthorizationResponseSchema = z.object({
  authorization: InstallationAuthorizationStatusSchema.nullable(),
});
export const InstallationAuthorizationAckRequestSchema=z.object({
  commandId:Uuid,authorizationId:Uuid,consumedAt:Timestamp,
});
export const CompleteBootstrapRequestSchema = z.object({
  pairingId: Uuid, pairingCode: z.string().regex(/^\d{6}$/), requestToken: z.string().min(43),
  authorization: InstallationAuthorizationEnvelopeSchema, ownerPin: z.string().regex(/^\d{4,12}$/),
});
export const InstallationComponentStateSchema = z.enum(['READY','DEGRADED','NOT_READY','PENDING_PHASE','NOT_APPLICABLE']);
export const InstallationReadinessSchema = z.object({
  technicalHealth: z.enum(['READY','NOT_READY']), operationalReadiness: z.enum(['READY','NOT_READY']),
  productionReadiness: z.literal('NOT_READY'), licensingStatus: z.string(),
  components: z.array(z.object({ key: z.string(), state: InstallationComponentStateSchema, code: z.string(), detail: z.string() })),
});

export type DeviceType = z.infer<typeof DeviceTypeSchema>;
export type PairingStatus = z.infer<typeof PairingStatusSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type PairingCreated = z.infer<typeof PairingCreatedSchema>;
export type PairingStatusResponse = z.infer<typeof PairingStatusResponseSchema>;
export type PairingAuthorizationData = z.infer<typeof PairingAuthorizationDataSchema>;
export type PairingListResponse = z.infer<typeof PairingListResponseSchema>;
export type CompleteBootstrapRequest = z.infer<typeof CompleteBootstrapRequestSchema>;
export type InstallationReadiness = z.infer<typeof InstallationReadinessSchema>;
export type InstallationAuthorizationPayload = z.infer<typeof InstallationAuthorizationPayloadSchema>;
export type InstallationAuthorizationEnvelope = z.infer<typeof InstallationAuthorizationEnvelopeSchema>;
export type IssueInstallationAuthorizationRequest = z.infer<typeof IssueInstallationAuthorizationRequestSchema>;
export type IssuedInstallationAuthorization = z.infer<typeof IssuedInstallationAuthorizationSchema>;
export type InstallationAuthorizationStatus = z.infer<typeof InstallationAuthorizationStatusSchema>;
