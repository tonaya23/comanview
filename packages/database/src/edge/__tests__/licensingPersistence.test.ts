import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CashRegister, CashSession, EntityId } from '@comanview/domain';
import { Money } from '@comanview/money';
import {
  AuditRepository,
  CashRepository,
  createEdgeDatabase,
  EdgeControlRepository,
  prepareDevelopmentDatabase,
  type NewAuditEntry,
} from '../../index.js';

const ids = {
  tenant: '01991a00-4000-7000-8000-000000000001',
  location: '01991a00-4000-7000-8000-000000000002',
  register: '01991a00-4000-7000-8000-000000000003',
  order: '01991a00-4000-7000-8000-000000000004',
  user: '01991a00-4000-7000-8000-000000000005',
  device: '01991a00-4000-7000-8000-000000000006',
  authSession: '01991a00-4000-7000-8000-000000000007',
};

describe('license recovery CashSession persistence', () => {
  let path: string;
  let handle: ReturnType<typeof createEdgeDatabase>;

  beforeEach(() => {
    path = resolve(tmpdir(), `comanview-license-cash-${randomUUID()}.db`);
    prepareDevelopmentDatabase(path);
    handle = createEdgeDatabase(path);
    handle.db.run(`INSERT INTO orders
      (id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at)
      VALUES('${ids.order}','${ids.tenant}','${ids.location}','COUNTER','POS','RECOVERY','MXN','OPEN',1,1)`);
  });

  afterEach(() => {
    handle.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  });

  it('atomically persists purpose, protected Orders, one-shot marker and Audit', () => {
    const cash = new CashRepository(handle.db);
    const control = new EdgeControlRepository(handle.db);
    const audit = new AuditRepository(handle.db);
    const session = recoverySession(cash);
    const entry = auditEntry(session.id.toString(), session.openCommandId);

    cash.openSession(session, { purpose: 'LICENSE_RECOVERY', openedLicenseRevision: 7,
      openedLicenseMode: 'PROTECTED_OPERATIONS', protectedOrderIds: [ids.order], audit: entry });

    expect(cash.getSessionMetadata(session.id.toString())).toEqual({
      purpose: 'LICENSE_RECOVERY', openedLicenseRevision: 7,
      openedLicenseMode: 'PROTECTED_OPERATIONS',
    });
    expect(control.recoverySessionAllows(session.id.toString(), ids.order)).toBe(true);
    expect(control.getRuntime().recoverySessionConsumed).toBe(true);
    expect(audit.getByCommand(session.openCommandId, 'LICENSE_RECOVERY_CASH_SESSION_OPENED'))
      .toMatchObject({ entityId: session.id.toString(), outcome: 'SUCCESS' });
  });

  it('rolls back the whole recovery opening when its protected binding is invalid', () => {
    const cash = new CashRepository(handle.db);
    const control = new EdgeControlRepository(handle.db);
    const audit = new AuditRepository(handle.db);
    const session = recoverySession(cash);

    expect(() => cash.openSession(session, { purpose: 'LICENSE_RECOVERY',
      openedLicenseRevision: 7, openedLicenseMode: 'PROTECTED_OPERATIONS',
      protectedOrderIds: ['01991a00-4000-7000-8000-000000000099'],
      audit: auditEntry(session.id.toString(), session.openCommandId) })).toThrow();

    expect(cash.getSessionById(session.id)).toBeNull();
    expect(control.getRuntime().recoverySessionConsumed).toBe(false);
    expect(audit.getByCommand(session.openCommandId, 'LICENSE_RECOVERY_CASH_SESSION_OPENED')).toBeNull();
  });
});

function recoverySession(cash: CashRepository): CashSession {
  const register = new CashRegister({ id: EntityId.fromString(ids.register),
    tenantId: EntityId.fromString(ids.tenant), locationId: EntityId.fromString(ids.location),
    name: 'Recovery register', currency: 'MXN', active: true, createdAt: new Date() });
  cash.saveRegister(register);
  return CashSession.open({ cashRegisterId: register.id, tenantId: register.tenantId,
    locationId: register.locationId, openingFloat: Money.zero('MXN'),
    businessDate: '2026-08-29', openedBy: EntityId.fromString(ids.user), commandId: randomUUID() });
}

function auditEntry(cashSessionId: string, commandId: string): NewAuditEntry {
  return { auditId: randomUUID(), occurredAt: new Date(), tenantId: ids.tenant,
    locationId: ids.location, deviceId: ids.device, sessionId: ids.authSession,
    actorUserId: ids.user, actorRole: 'CASHIER', authorizedByUserId: null,
    authorizedByRole: null, action: 'LICENSE_RECOVERY_CASH_SESSION_OPENED',
    entityType: 'CASH_SESSION', entityId: cashSessionId, outcome: 'SUCCESS',
    reason: 'Restricted license recovery for protected Orders', commandId,
    before: null, after: { purpose: 'LICENSE_RECOVERY', orderIds: [ids.order] },
    amountAffected: 0, currency: 'MXN', eventId: null };
}
