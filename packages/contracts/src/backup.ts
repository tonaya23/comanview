import { z } from 'zod';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime();
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const BackupTriggerSchema = z.enum(['PERIODIC','MANUAL','POST_Z','PRE_MAINTENANCE','SAFETY']);
export const BackupDestinationTypeSchema = z.enum(['LOCAL','OFF_DEVICE']);
export const BackupRecordStatusSchema = z.enum(['CREATING','VERIFIED','FAILED','DELETED']);
export const RecoveryRuntimeStateSchema = z.enum(['NORMAL','RECOVERY_REQUIRED','RECOVERY_IN_PROGRESS']);

export const BackupManifestSchema = z.object({
  formatVersion: z.literal(1),
  backupId: Uuid,
  tenantId: Uuid,
  locationId: Uuid,
  sourceEdgeId: Uuid,
  recoveryEpoch: z.number().int().nonnegative(),
  createdAt: Timestamp,
  applicationVersion: z.string().min(1).max(80),
  schemaVersion: z.number().int().nonnegative(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  trigger: BackupTriggerSchema,
  destinationType: BackupDestinationTypeSchema,
  plaintextSizeBytes: z.number().int().nonnegative(),
  ciphertextSizeBytes: z.number().int().nonnegative(),
  ciphertextSha256: Sha256,
  encryption: z.object({
    algorithm: z.literal('AES-256-GCM'),
    payloadIv: z.string().min(16),
    payloadTag: z.string().min(16),
    wrappedDekIv: z.string().min(16),
    wrappedDekTag: z.string().min(16),
    wrappedDek: z.string().min(32),
  }),
}).strict();

export const BackupRecordSchema = z.object({
  backupId: Uuid,
  status: BackupRecordStatusSchema,
  trigger: BackupTriggerSchema,
  destinationType: BackupDestinationTypeSchema,
  createdAt: Timestamp,
  completedAt: Timestamp.nullable(),
  verifiedAt: Timestamp.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  failureCode: z.string().nullable(),
});

export const BackupProtectionStatusSchema = z.object({
  recoveryState: RecoveryRuntimeStateSchema,
  localBackupStatus: z.enum(['READY','DEGRADED','NOT_READY']),
  offDeviceBackupStatus: z.enum(['READY','DEGRADED','NOT_CONFIGURED','NOT_READY']),
  workerStatus: z.enum(['IDLE','RUNNING','DEGRADED']),
  lastSuccessfulBackup: Timestamp.nullable(),
  lastVerifiedBackup: BackupRecordSchema.nullable(),
  lastFailure: z.string().nullable(),
  recoveryKeyAvailable: z.boolean(),
  recoveryKeyExported: z.boolean(),
  recoveryPreparedness: z.enum(['READY','DEGRADED','NOT_READY']),
  nextPeriodicBackupAt: Timestamp.nullable(),
  recentBackups: z.array(BackupRecordSchema),
});

export const CreateBackupRequestSchema = z.object({
  commandId: Uuid,
  destinationType: BackupDestinationTypeSchema.default('LOCAL'),
});
export const ConfigureOffDeviceBackupRequestSchema = z.object({
  commandId: Uuid,
  directoryPath: z.string().trim().min(3).max(1024),
});
export const RecoveryKeyExportRequestSchema = z.object({
  commandId: Uuid,
  confirmation: z.literal('EXPORT_RECOVERY_KEY'),
});
export const RecoveryKeyExportResponseSchema = z.object({
  recoveryKey: z.string().min(43).max(128),
});
export const RestoreBackupRequestSchema = z.object({
  commandId: Uuid,
  backupId: Uuid,
  artifactPath: z.string().trim().min(3).max(2048).optional(),
  confirmation: z.literal('RESTORE_VERIFIED_BACKUP'),
  recoveryKey: z.string().min(43).max(128).optional(),
  recoveryAuthorization: z.object({ protected:z.string(),payload:z.string(),signature:z.string() }).optional(),
});
export const RestoreScheduledResponseSchema = z.object({scheduled:z.literal(true),recoveryState:z.literal('RECOVERY_IN_PROGRESS')});
export const EmergencyRestoreRequestSchema = RestoreBackupRequestSchema.extend({
  artifactPath: z.string().trim().min(3).max(2048),
  recoveryKey: z.string().min(43).max(128),
});
export const RecoveryBootstrapStatusSchema = z.object({
  recoveryState:z.literal('RECOVERY_REQUIRED'),
  installationEstablished:z.literal(true),
  bindingAvailable:z.boolean(),
});

export const RecoveryAuthorizationPayloadSchema = z.object({
  formatVersion: z.literal(1),
  typ: z.literal('comanview-recovery-authorization'),
  authorizationId: Uuid,
  tenantId: Uuid,
  locationId: Uuid,
  sourceEdgeId: Uuid,
  targetEdgeId: Uuid,
  backupId: Uuid,
  recoveryEpoch: z.number().int().positive(),
  purpose: z.literal('HARDWARE_REPLACEMENT_RESTORE'),
  issuedAt: Timestamp,
  expiresAt: Timestamp,
  nonce: Uuid,
}).strict();
export const RecoveryAuthorizationEnvelopeSchema = z.object({
  protected:z.string().min(1),payload:z.string().min(1),signature:z.string().min(1),
});
export const IssueRecoveryAuthorizationRequestSchema = z.object({
  commandId:Uuid,sourceEdgeId:Uuid,targetEdgeId:Uuid,backupId:Uuid,
  reason:z.string().trim().min(3).max(500),
});
export const IssuedRecoveryAuthorizationSchema = z.object({
  authorizationId:Uuid,status:z.enum(['ISSUED','CONSUMED','EXPIRED','REVOKED']),
  expiresAt:Timestamp,authorization:RecoveryAuthorizationEnvelopeSchema,
});
export const ConsumeRecoveryAuthorizationRequestSchema = z.object({
  commandId:Uuid,authorizationId:Uuid,consumedAt:Timestamp,
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;
export type BackupRecord = z.infer<typeof BackupRecordSchema>;
export type BackupProtectionStatus = z.infer<typeof BackupProtectionStatusSchema>;
export type BackupTrigger = z.infer<typeof BackupTriggerSchema>;
export type BackupDestinationType = z.infer<typeof BackupDestinationTypeSchema>;
export type RecoveryAuthorizationPayload = z.infer<typeof RecoveryAuthorizationPayloadSchema>;
export type RecoveryAuthorizationEnvelope = z.infer<typeof RecoveryAuthorizationEnvelopeSchema>;
export type IssuedRecoveryAuthorization = z.infer<typeof IssuedRecoveryAuthorizationSchema>;
