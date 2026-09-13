import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PersonnelSecurityFloorSchema, assertPersonnelReceipt, nextPersonnelRevisions, personnelRestrictions,
  personnelSessionIsCurrent, personnelTransitionDigest, type PersonnelSecurityFloor, type PersonnelTransitionDescriptor,
  type StoredPersonnelSecurity } from './PersonnelSecurityModel.js';

function fixture() {
  const userId = randomUUID(), trustDomainId = randomUUID();
  const floor: PersonnelSecurityFloor = { formatVersion: 1, trustDomainId, initializationState: 'ACTIVE',
    users: { [userId]: { credentialRevision: 3, authorizationRevision: 4, sessionRevision: 6, pending: null } },
    ownerRecoveryAccess: { generation: 0, challenge: null, pendingConsumption: null } };
  const user: StoredPersonnelSecurity = { userId, trustDomainId, credentialRevision: 3, authorizationRevision: 4, status: 'ACTIVE' };
  const descriptor: PersonnelTransitionDescriptor = { formatVersion: 1, tenantId: randomUUID(), locationId: randomUUID(), edgeId: randomUUID(),
    userId, trustDomainId, transitionId: randomUUID(), commandId: randomUUID(), kind: 'CHANGE_AUTHORIZATION',
    authority: { kind: 'USER', userId: randomUUID() },
    from: { credentialRevision: 3, authorizationRevision: 4, sessionRevision: 6 },
    target: { credentialRevision: 3, authorizationRevision: 5, sessionRevision: 7 },
    targetStatus: 'ACTIVE', targetRoleIds: ['role-cashier', 'role-waiter'], supersededTransitionId: null };
  return { floor, user, descriptor };
}

describe('personnel anti-rollback comparison and transition commitments', () => {
  it('blocks old PIN even when the restored hash could match', () => {
    const { floor, user } = fixture(); user.credentialRevision = 2;
    expect(personnelRestrictions(floor, user)).toEqual(['CREDENTIAL_RESET_REQUIRED']);
  });
  it('blocks restored MANAGER or ACTIVE from an obsolete authorization', () => {
    const { floor, user } = fixture(); user.authorizationRevision = 3;
    expect(personnelRestrictions(floor, user)).toEqual(['USER_REVIEW_REQUIRED']);
  });
  it('allows a newly authorized reenable, without a sticky disabled flag', () => {
    const { floor, user } = fixture();
    const next = nextPersonnelRevisions(floor.users[user.userId]!, 'REENABLE');
    floor.users[user.userId] = { ...next, pending: null };
    user.authorizationRevision = next.authorizationRevision; user.credentialRevision = next.credentialRevision;
    expect(personnelRestrictions(floor, user)).toEqual([]);
    user.authorizationRevision = 3;
    expect(personnelRestrictions(floor, user)).toContain('USER_REVIEW_REQUIRED');
  });
  it('keeps credential rotation and authorization changes independent', () => {
    const { descriptor } = fixture();
    expect(nextPersonnelRevisions(descriptor.from, 'ROTATE_CREDENTIAL')).toEqual({ credentialRevision: 4, authorizationRevision: 4, sessionRevision: 7 });
    expect(nextPersonnelRevisions(descriptor.from, 'CHANGE_AUTHORIZATION')).toEqual(descriptor.target);
    expect(nextPersonnelRevisions(descriptor.from, 'INVALIDATE_SESSIONS')).toEqual({ ...descriptor.from, sessionRevision: 7 });
  });
  it('rejects all restored sessions via epoch even when user revisions match', () => {
    const { floor, user, descriptor } = fixture();
    const session = { ...descriptor.from, trustDomainId: floor.trustDomainId, issuedRecoveryEpoch: 2 };
    expect(personnelSessionIsCurrent(floor, user, session, 2)).toBe(true);
    expect(personnelSessionIsCurrent(floor, user, session, 3)).toBe(false);
    floor.users[user.userId]!.sessionRevision++;
    expect(personnelSessionIsCurrent(floor, user, session, 2)).toBe(false);
  });
  it('does not trust personnel from a replaced hardware trust domain', () => {
    const { floor, user } = fixture(); floor.trustDomainId = randomUUID();
    expect(personnelRestrictions(floor, user)).toEqual(['USER_UNTRUSTED']);
  });
  it('keeps legacy or unknown users untrusted', () => {
    const { floor, user } = fixture();
    expect(personnelRestrictions(floor, { ...user, trustDomainId: null })).toEqual(['USER_UNTRUSTED']);
    expect(personnelRestrictions(floor, { ...user, userId: randomUUID() })).toEqual(['USER_UNTRUSTED']);
  });
  it('rejects revisions above floor instead of importing max from SQLite', () => {
    const { floor, user } = fixture(); user.authorizationRevision = 99;
    expect(personnelRestrictions(floor, user)).toEqual(['USER_SECURITY_REVISION_CONFLICT']);
  });
  it('retains both independent review requirements', () => {
    const { floor, user } = fixture(); user.credentialRevision = 1; user.authorizationRevision = 1;
    expect(personnelRestrictions(floor, user)).toEqual(['CREDENTIAL_RESET_REQUIRED', 'USER_REVIEW_REQUIRED']);
  });
  it('commits to roles, enabled decision and exact transition IDs canonically', () => {
    const { descriptor } = fixture(); const digest = personnelTransitionDigest(descriptor);
    expect(personnelTransitionDigest({ ...descriptor, targetRoleIds: [...descriptor.targetRoleIds!].reverse() })).toBe(digest);
    for (const change of [{ targetRoleIds: ['role-manager'] }, { targetStatus: 'DISABLED' }, { commandId: randomUUID() },
      { trustDomainId: randomUUID() }, { transitionId: randomUUID() }])
      expect(personnelTransitionDigest({ ...descriptor, ...change })).not.toBe(digest);
  });
  it.each(['pin', 'pinHash', 'token', 'recoveryKey', 'displayName'])('rejects %s in descriptors and floor entries', key => {
    const { descriptor, floor, user } = fixture();
    expect(() => personnelTransitionDigest({ ...descriptor, [key]: 'forbidden' })).toThrow();
    expect(() => PersonnelSecurityFloorSchema.parse({ ...floor,
      users: { [user.userId]: { ...floor.users[user.userId], [key]: 'forbidden' } } })).toThrow();
  });
  it('requires matching pending, descriptor, digest and receipt before completion', () => {
    const { descriptor, floor, user } = fixture(); const digest = personnelTransitionDigest(descriptor);
    const entry = { ...descriptor.target, pending: { transitionId: descriptor.transitionId, commandId: descriptor.commandId,
      kind: descriptor.kind, authority: descriptor.authority, transitionDigest: digest } };
    floor.users[user.userId] = entry;
    expect(personnelRestrictions(floor, user)).toEqual(['USER_SECURITY_REPAIR_REQUIRED']);
    expect(() => assertPersonnelReceipt(entry, descriptor, digest)).not.toThrow();
    expect(() => assertPersonnelReceipt(entry, { ...descriptor, targetRoleIds: ['role-manager'] }, digest)).toThrow('USER_SECURITY_RECEIPT_MISMATCH');
    expect(() => assertPersonnelReceipt(entry, descriptor, '0'.repeat(64))).toThrow('USER_SECURITY_RECEIPT_MISMATCH');
  });
  it('never wraps overflowing revisions', () => {
    expect(() => nextPersonnelRevisions({ credentialRevision: Number.MAX_SAFE_INTEGER, authorizationRevision: 1, sessionRevision: 1 },
      'ROTATE_CREDENTIAL')).toThrow();
  });
});
