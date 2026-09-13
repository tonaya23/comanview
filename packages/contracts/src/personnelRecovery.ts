import { z } from 'zod';
const Id=z.string().uuid(),Revision=z.number().int().safe().nonnegative();
export const PersonnelRecoveryContextSchema=z.object({
  tenantId:Id,locationId:Id,sourceEdgeId:Id,targetEdgeId:Id,recoveryId:Id,backupId:Id,recoveryEpoch:Revision,
  restoreAuthorizationId:Id.nullable(),trustDomainId:Id,accessGeneration:Revision,challengeId:Id,deviceId:Id,pairingId:Id.nullable(),
}).strict();
export const OwnerRecoveryAuthorizationPayloadSchema=PersonnelRecoveryContextSchema.extend({
  formatVersion:z.literal(1),typ:z.literal('comanview-owner-recovery-authorization'),purpose:z.literal('RESTORE_CONTRACTUAL_OWNER'),
  authorizationId:Id,ownerUserId:Id,issuedAt:z.string().datetime(),expiresAt:z.string().datetime(),
}).strict().superRefine((p,ctx)=>{
  const duration=Date.parse(p.expiresAt)-Date.parse(p.issuedAt);
  if(duration<=0||duration>600_000)ctx.addIssue({code:z.ZodIssueCode.custom,message:'OWNER_RECOVERY_AUTHORIZATION_LIFETIME_INVALID'});
  if((p.sourceEdgeId!==p.targetEdgeId)!==Boolean(p.restoreAuthorizationId))ctx.addIssue({code:z.ZodIssueCode.custom,message:'OWNER_RECOVERY_RESTORE_BINDING_INVALID'});
});
export const OwnerRecoveryAuthorizationEnvelopeSchema=z.object({protected:z.string().min(1).max(2048),payload:z.string().min(1).max(16384),signature:z.string().min(1).max(1024)}).strict();
export const IssueOwnerRecoveryAuthorizationRequestSchema=z.object({commandId:Id,context:PersonnelRecoveryContextSchema,reason:z.string().trim().min(3).max(500)}).strict();
export const CompleteOwnerRecoveryRequestSchema=z.object({commandId:Id,authorization:OwnerRecoveryAuthorizationEnvelopeSchema,
  newPin:z.string().regex(/^\d{4,12}$/),deviceCredential:z.string().min(32).max(512),requestToken:z.string().min(43).max(512).optional()}).strict();
export const OwnerRecoveryAuthorizationResultSchema=z.object({authorizationId:Id,status:z.enum(['ISSUED','CONSUMED','EXPIRED','REVOKED']),expiresAt:z.string().datetime(),authorization:OwnerRecoveryAuthorizationEnvelopeSchema});
export type PersonnelRecoveryContext=z.infer<typeof PersonnelRecoveryContextSchema>;
export type OwnerRecoveryAuthorizationPayload=z.infer<typeof OwnerRecoveryAuthorizationPayloadSchema>;
export type OwnerRecoveryAuthorizationEnvelope=z.infer<typeof OwnerRecoveryAuthorizationEnvelopeSchema>;
export type IssueOwnerRecoveryAuthorizationRequest=z.infer<typeof IssueOwnerRecoveryAuthorizationRequestSchema>;
export type CompleteOwnerRecoveryRequest=z.infer<typeof CompleteOwnerRecoveryRequestSchema>;
