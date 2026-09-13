import { z } from 'zod';
const Id=z.string().uuid(),Pin=z.string().regex(/^\d{4,12}$/);
const Roles=z.array(z.enum(['OWNER','MANAGER','CASHIER','WAITER','KITCHEN'])).min(1).max(5).refine(roles=>new Set(roles).size===roles.length);
export const PersonnelMutationSchema=z.object({commandId:Id,userId:Id,expectedVersion:z.number().int().safe().nonnegative(),
  kind:z.enum(['ENROLL','RENAME','ROTATE_CREDENTIAL','CHANGE_AUTHORIZATION','DISABLE','REENABLE','INVALIDATE_SESSIONS','RESOLVE_RESTORED_USER','REPAIR']),
  reason:z.string().trim().min(3).max(500),displayName:z.string().trim().min(1).max(120).optional(),roles:Roles.optional(),
  status:z.enum(['ACTIVE','DISABLED']).optional(),newPin:Pin.optional(),oldPin:Pin.optional()}).strict();
export const PersonnelUserSchema=z.object({userId:Id,displayName:z.string(),status:z.enum(['ACTIVE','DISABLED']),version:z.number().int().positive(),
  roles:z.array(z.string()),credentialRevision:z.number().int().nullable(),authorizationRevision:z.number().int().nullable(),restrictions:z.array(z.string())});
export const PersonnelListSchema=z.object({ownerRecoveryRequired:z.boolean(),users:z.array(PersonnelUserSchema)});
export type PersonnelList=z.infer<typeof PersonnelListSchema>;
export const OwnerRecoveryChallengeRequestSchema=z.object({deviceId:Id,deviceCredential:z.string().min(32).max(512),pairingId:Id.nullable(),requestToken:z.string().min(43).max(512).optional()}).strict();
export type PersonnelMutation=z.infer<typeof PersonnelMutationSchema>;
