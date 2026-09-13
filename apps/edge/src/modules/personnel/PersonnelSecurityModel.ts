import { createHash } from 'node:crypto';
import { z } from 'zod';

const Id = z.string().uuid();
const Revision = z.number().int().safe().nonnegative();
export const PersonnelRevisionsSchema = z.object({
  credentialRevision: Revision,
  authorizationRevision: Revision,
  sessionRevision: Revision,
}).strict();
export type PersonnelRevisions = z.infer<typeof PersonnelRevisionsSchema>;

export const PersonnelTransitionKindSchema = z.enum([
  'ENROLL', 'RENAME', 'ROTATE_CREDENTIAL', 'CHANGE_AUTHORIZATION', 'DISABLE', 'REENABLE',
  'INVALIDATE_SESSIONS', 'RESOLVE_RESTORED_USER', 'REPAIR', 'RECOVER_OWNER',
]);
export type PersonnelTransitionKind = z.infer<typeof PersonnelTransitionKindSchema>;
const Authority = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('USER'), userId: Id }).strict(),
  z.object({ kind: z.literal('OWNER_RECOVERY'), authorizationId: Id }).strict(),
  z.object({ kind: z.literal('INSTALLATION_AUTHORIZATION'), authorizationId: Id }).strict(),
]);

/** Whitelist: the digest must NEVER include a PIN, hash, token or free-form reason. */
export const PersonnelTransitionDescriptorSchema = z.object({
  formatVersion: z.literal(1),
  tenantId: Id, locationId: Id, edgeId: Id,
  trustDomainId: Id,
  userId: Id, transitionId: Id, commandId: Id,
  kind: PersonnelTransitionKindSchema,
  authority: Authority,
  authorizedDeviceId:Id.optional(),authorizedPairingId:Id.nullable().optional(),
  from: PersonnelRevisionsSchema,
  target: PersonnelRevisionsSchema,
  targetStatus: z.enum(['ACTIVE', 'DISABLED']).nullable(),
  targetRoleIds: z.array(z.string().min(1).max(120)).max(5).nullable(),
  supersededTransitionId: Id.nullable(),
}).strict();
export type PersonnelTransitionDescriptor = z.infer<typeof PersonnelTransitionDescriptorSchema>;

export const PendingPersonnelTransitionSchema = z.object({
  transitionId: Id, commandId: Id, kind: PersonnelTransitionKindSchema, authority: Authority,
  transitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const UserSecurityFloorEntrySchema = PersonnelRevisionsSchema.extend({
  credentialRevision: Revision.positive(),
  authorizationRevision: Revision.positive(),
  sessionRevision: Revision.positive(),
  pending: PendingPersonnelTransitionSchema.nullable(),
}).strict();
export type UserSecurityFloorEntry = z.infer<typeof UserSecurityFloorEntrySchema>;

export const PersonnelSecurityFloorSchema = z.object({
  formatVersion: z.literal(1), trustDomainId: Id,
  initializationState: z.enum(['INITIALIZING', 'ACTIVE']),
  recoveryContext:z.object({recoveryId:Id,backupId:Id,sourceEdgeId:Id,targetEdgeId:Id,recoveryEpoch:Revision,
    restoreAuthorizationId:Id.nullable()}).strict().optional(),
  users: z.record(Id, UserSecurityFloorEntrySchema),
  ownerRecoveryAccess: z.object({
    generation: Revision,
    challenge: z.object({ challengeId: Id, deviceId: Id, pairingId: Id.nullable() }).strict().nullable(),
    pendingConsumption: z.object({ authorizationId: Id, transitionId: Id }).strict().nullable(),
  }).strict(),
}).strict();
export type PersonnelSecurityFloor = z.infer<typeof PersonnelSecurityFloorSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function personnelTransitionDigest(input: unknown): string {
  const descriptor = PersonnelTransitionDescriptorSchema.parse(input);
  if (descriptor.targetRoleIds) {
    if (new Set(descriptor.targetRoleIds).size !== descriptor.targetRoleIds.length)
      throw new Error('PERSONNEL_ROLE_ASSIGNMENT_INVALID');
    descriptor.targetRoleIds.sort();
  }
  return createHash('sha256').update(`comanview-personnel-transition-v1\n${canonical(descriptor)}`).digest('hex');
}

export function assertPersonnelReceipt(entry: UserSecurityFloorEntry, descriptor: unknown, receiptDigest: string): void {
  const parsed = PersonnelTransitionDescriptorSchema.parse(descriptor);
  const digest = personnelTransitionDigest(parsed);
  if (!entry.pending || entry.pending.transitionId !== parsed.transitionId ||
    entry.pending.commandId !== parsed.commandId || entry.pending.kind !== parsed.kind ||
    entry.pending.transitionDigest !== digest || receiptDigest !== digest ||
    canonical(entry.pending.authority) !== canonical(parsed.authority) ||
    !sameRevisions(entry, parsed.target)) throw new Error('USER_SECURITY_RECEIPT_MISMATCH');
}

export function sameRevisions(a: PersonnelRevisions, b: PersonnelRevisions): boolean {
  return a.credentialRevision === b.credentialRevision && a.authorizationRevision === b.authorizationRevision &&
    a.sessionRevision === b.sessionRevision;
}

/** This computes targets only. It is NOT an authorization or a persistence API. */
export function nextPersonnelRevisions(current: PersonnelRevisions, kind: PersonnelTransitionKind): PersonnelRevisions {
  PersonnelRevisionsSchema.parse({ credentialRevision: current.credentialRevision,
    authorizationRevision: current.authorizationRevision, sessionRevision: current.sessionRevision });
  PersonnelTransitionKindSchema.parse(kind);
  const credential = ['ENROLL', 'ROTATE_CREDENTIAL', 'REENABLE', 'REPAIR', 'RECOVER_OWNER'].includes(kind);
  const authorization = ['ENROLL', 'CHANGE_AUTHORIZATION', 'DISABLE', 'REENABLE', 'REPAIR', 'RECOVER_OWNER'].includes(kind);
  if (kind === 'RESOLVE_RESTORED_USER')
    throw new Error('PERSONNEL_REVIEW_DIMENSIONS_REQUIRED');
  return PersonnelRevisionsSchema.parse({
    credentialRevision: current.credentialRevision + Number(credential),
    authorizationRevision: current.authorizationRevision + Number(authorization),
    sessionRevision: current.sessionRevision + 1,
  });
}

export interface StoredPersonnelSecurity {
  userId: string;
  trustDomainId: string | null;
  credentialRevision: number | null;
  authorizationRevision: number | null;
  status: 'ACTIVE' | 'DISABLED';
}
export type PersonnelRestriction = 'PERSONNEL_SECURITY_NOT_INITIALIZED' | 'USER_UNTRUSTED' |
  'USER_SECURITY_REPAIR_REQUIRED' | 'CREDENTIAL_RESET_REQUIRED' | 'USER_REVIEW_REQUIRED' |
  'USER_SECURITY_REVISION_CONFLICT' | 'USER_DISABLED';

/** A restriction never upgrades old state. Unknown/legacy rows require explicit enrollment. */
export function personnelRestrictions(floor: PersonnelSecurityFloor, row: StoredPersonnelSecurity): PersonnelRestriction[] {
  if (floor.initializationState !== 'ACTIVE') return ['PERSONNEL_SECURITY_NOT_INITIALIZED'];
  const entry = floor.users[row.userId];
  if (!entry || row.trustDomainId !== floor.trustDomainId) return ['USER_UNTRUSTED'];
  if (entry.pending) return ['USER_SECURITY_REPAIR_REQUIRED'];
  if (row.credentialRevision === null || row.authorizationRevision === null) return ['USER_UNTRUSTED'];
  if (!Number.isSafeInteger(row.credentialRevision) || !Number.isSafeInteger(row.authorizationRevision) ||
    row.credentialRevision > entry.credentialRevision || row.authorizationRevision > entry.authorizationRevision)
    return ['USER_SECURITY_REVISION_CONFLICT'];
  const restrictions: PersonnelRestriction[] = [];
  if (row.credentialRevision < entry.credentialRevision) restrictions.push('CREDENTIAL_RESET_REQUIRED');
  if (row.authorizationRevision < entry.authorizationRevision) restrictions.push('USER_REVIEW_REQUIRED');
  if (row.status !== 'ACTIVE') restrictions.push('USER_DISABLED');
  return restrictions;
}

export function personnelSessionIsCurrent(floor: PersonnelSecurityFloor, row: StoredPersonnelSecurity,
  session: PersonnelRevisions & { trustDomainId: string; issuedRecoveryEpoch: number }, recoveryEpoch: number): boolean {
  const entry = floor.users[row.userId];
  return Boolean(entry && personnelRestrictions(floor, row).length === 0 &&
    session.trustDomainId === floor.trustDomainId && session.issuedRecoveryEpoch === recoveryEpoch &&
    sameRevisions(session, entry));
}
