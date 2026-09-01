import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEdgeDatabase, EdgeControlRepository, prepareDevelopmentDatabase } from '@comanview/database';
import type {
  CapabilityCode,
  ConfigurationDocumentPayload,
  FeatureFlagsDocumentPayload,
  LicenseDocumentPayload,
} from '@comanview/contracts';
import { hashSignedEnvelope, signControlDocument } from '@comanview/licensing';
import { EdgeLicenseManager } from './EdgeLicenseManager.js';
import { ControlTransportError, type HttpControlTransport } from './HttpControlTransport.js';

const ids = {
  tenant: '01991a00-2000-7000-8000-000000000001',
  location: '01991a00-2000-7000-8000-000000000002',
  edge: '01991a00-2000-7000-8000-000000000003',
  order: '01991a00-2000-7000-8000-000000000004',
  register: '01991a00-0000-7000-8000-000000000303',
  user: '01991a00-0000-7000-8000-000000000304',
  session: '01991a00-2000-7000-8000-000000000005',
};

describe('EdgeLicenseManager durable offline policy', () => {
  let path: string;
  let database: ReturnType<typeof createEdgeDatabase>;
  let repository: EdgeControlRepository;
  let manager: EdgeLicenseManager;
  let now: number;

  beforeEach(() => {
    path = resolve(tmpdir(), `comanview-license-${randomUUID()}.db`);
    prepareDevelopmentDatabase(path);
    database = createEdgeDatabase(path);
    repository = new EdgeControlRepository(database.db);
    manager = new EdgeLicenseManager(repository, null, {
      enforcementEnabled: true, publicKeyring: { test: 'unused' }, pullIntervalMs: 300_000,
      maxBackoffMs: 3_600_000, checkpointIntervalMs: 60_000,
    }, { tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge });
    now = Date.now();
  });

  afterEach(() => {
    database.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
  });

  it('moves from valid to grace, then protects a demonstrably authorized open shift', () => {
    applyLicense(1, 'ACTIVE', now + 1_000, now + 2_000);
    expect(manager.effectiveCapabilities().mode).toBe('FULL');
    repository.updateRuntime({ effectiveTimeFloor: new Date(now + 1_500) });
    expect(manager.effectiveCapabilities().mode).toBe('GRACE_OPERATING');

    insertOpenCashSession('NORMAL', 1, 'FULL');
    repository.updateRuntime({ effectiveTimeFloor: new Date(now + 2_500) });
    expect(manager.effectiveCapabilities().mode).toBe('GUARANTEED_SHIFT');
    expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).not.toThrow();
    expect(() => manager.assertAllowed('CASH_SESSION_OPEN_NORMAL', 'CORE_POS')).toThrow();
  });

  it('captures pre-existing Orders and permits only restricted recovery obligations', () => {
    insertOpenOrder();
    applyLicense(1, 'ACTIVE', now - 2_000, now - 1_000);
    const effective = manager.effectiveCapabilities();
    expect(effective.mode).toBe('PROTECTED_OPERATIONS');
    expect(effective.protectedOrderCount).toBe(1);
    expect(() => manager.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', ids.order)).toThrow();
    expect(() => manager.assertAllowed('ORDER_SEND', 'CORE_POS', ids.order)).not.toThrow();
    expect(() => manager.assertAllowed('CASH_SESSION_OPEN_RECOVERY', 'CORE_POS')).not.toThrow();

    insertOpenCashSession('LICENSE_RECOVERY', 1, 'PROTECTED_OPERATIONS');
    repository.bindRecoverySession(ids.session, [ids.order]);
    expect(manager.effectiveCapabilities().mode).toBe('GUARANTEED_SHIFT_RECOVERY');
    expect(() => manager.assertAllowed('PAYMENT_CREATE', 'CORE_POS', ids.order)).not.toThrow();
    expect(() => manager.assertAllowed('CASH_REPORT', 'CORE_POS')).not.toThrow();
    expect(() => manager.assertAllowed('CASH_CLOSE', 'CORE_POS')).not.toThrow();
    expect(() => manager.assertAllowed('CASH_MOVEMENT', 'CORE_POS')).toThrow();
    expect(() => manager.assertAllowed('PAYMENT_VOID', 'CORE_POS', ids.order)).toThrow();
    expect(() => manager.assertAllowed('ORDER_CREATE', 'CORE_POS')).toThrow();
    database.db.run(`UPDATE orders SET status='CLOSED' WHERE id='${ids.order}'`);
    expect(manager.effectiveCapabilities().protectedOrderCount).toBe(0);
    expect(() => manager.assertAllowed('CASH_CLOSE', 'CORE_POS')).not.toThrow();
  });

  it('keeps TERMINATED sticky offline and never grants fallback without durable shift proof', () => {
    applyLicense(1, 'TERMINATED', now + 10_000, now + 20_000);
    expect(manager.effectiveCapabilities().mode).toBe('TERMINATED_BLOCKED');
    applyLicense(2, 'ACTIVE', now + 10_000, now + 20_000);
    expect(manager.effectiveCapabilities().mode).toBe('FULL');

    database.db.run('DELETE FROM edge_control_documents');
    insertOpenCashSession('NORMAL', null, null);
    expect(manager.effectiveCapabilities().mode).toBe('NO_VALID_LICENSE');
  });

  it('defers an entitlement reduction only for the authorized open shift', () => {
    applyLicense(1, 'ACTIVE', now + 10_000, now + 20_000, ['CORE_POS','KDS']);
    insertOpenCashSession('NORMAL', 1, 'FULL');
    applyLicense(2, 'ACTIVE', now + 10_000, now + 20_000, ['CORE_POS'], ['CORE_POS','KDS']);
    expect(manager.effectiveCapabilities().capabilities).toContain('KDS');

    database.db.run(`UPDATE cash_sessions SET status='CLOSED', closed_at=${now} WHERE id='${ids.session}'`);
    expect(manager.effectiveCapabilities().capabilities).not.toContain('KDS');
    expect(repository.getRuntime().protectedCapabilities).toEqual([]);
  });

  it('protects pre-existing Orders when entitlements shrink without an open CashSession', () => {
    insertOpenOrder();
    applyLicense(1, 'ACTIVE', now + 10_000, now + 20_000, ['CORE_POS','KDS']);
    applyLicense(2, 'ACTIVE', now + 10_000, now + 20_000, ['CORE_POS'], ['CORE_POS','KDS']);
    repository.updateRuntime({ restrictionStartedAt: new Date(now) });
    repository.captureOpenOrders(2, new Date(now));

    expect(manager.effectiveCapabilities()).toMatchObject({
      mode: 'PROTECTED_OPERATIONS', capabilities: ['CORE_POS','KDS'], protectedOrderCount: 1,
    });
    expect(() => manager.assertAllowed('KDS_UPDATE', 'KDS', ids.order)).not.toThrow();
    expect(() => manager.assertAllowed('ORDER_ADD_ITEM', 'CORE_POS', ids.order)).toThrow();

    database.db.run(`UPDATE orders SET status='CLOSED' WHERE id='${ids.order}'`);
    expect(manager.effectiveCapabilities()).toMatchObject({ mode: 'FULL', capabilities: ['CORE_POS'] });
  });

  it('rejects revision equivocation, ignores rollback and retains three valid revisions', () => {
    applyLicense(1, 'ACTIVE', now + 10_000, now + 20_000);
    applyLicense(2, 'ACTIVE', now + 10_000, now + 20_000);
    applyLicense(3, 'ACTIVE', now + 10_000, now + 20_000);
    applyLicense(4, 'ACTIVE', now + 10_000, now + 20_000);
    expect(repository.currentDocument<LicenseDocumentPayload>('LICENSE')?.revision).toBe(4);
    expect(database.db.get<{ count: number }>(
      "SELECT count(*) AS count FROM edge_control_documents WHERE document_type='LICENSE'",
    )).toMatchObject({ count: 3 });
    expect(applyLicense(2, 'ACTIVE', now + 10_000, now + 20_000)).toBe('OLDER');

    const current = repository.currentDocument<LicenseDocumentPayload>('LICENSE')!;
    expect(() => repository.applyDocument({ payload: current.payload,
      envelope: { protected: 'different', payload: 'y', signature: 'z' },
      documentHash: 'f'.repeat(64), receivedAt: new Date(now) }))
      .toThrow('CONTROL_DOCUMENT_REVISION_HASH_CONFLICT');
    expect(repository.currentDocument<LicenseDocumentPayload>('LICENSE')).toMatchObject({
      revision: 4, documentHash: '4'.padStart(64, '0'),
    });
  });

  it('keeps configuration separate and never lets Feature Flags grant an absent entitlement', () => {
    applyLicense(1, 'ACTIVE', now + 10_000, now + 20_000, ['CORE_POS']);
    repository.applyDocument({ payload: {
      documentType: 'FEATURE_FLAGS', formatVersion: 1,
      documentId: '01991a00-2000-7000-8000-000000000201', revision: 1,
      tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge,
      issuedAt: new Date(now).toISOString(), flags: { 'kds.enabled': true },
    }, envelope: { protected: 'x', payload: 'y', signature: 'z' },
    documentHash: 'a'.repeat(64), receivedAt: new Date(now) });
    repository.applyDocument({ payload: {
      documentType: 'CONFIGURATION', formatVersion: 1,
      documentId: '01991a00-2000-7000-8000-000000000202', revision: 1,
      tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge,
      issuedAt: new Date(now).toISOString(),
      configuration: { payment: { tipsEnabled: false, tipPercentageOptionsBasisPoints: [] } },
    }, envelope: { protected: 'x', payload: 'y', signature: 'z' },
    documentHash: 'b'.repeat(64), receivedAt: new Date(now) });

    expect(manager.effectiveCapabilities().capabilities).toEqual(['CORE_POS']);
    expect(manager.currentConfiguration().payment).toEqual({
      tipsEnabled: false, tipPercentageOptionsBasisPoints: [],
    });
  });

  it('enforces signed per-type Device limits without treating legacy documents as unlimited',()=>{
    applyLicense(1,'ACTIVE',now+10_000,now+20_000,['CORE_POS','TABLE_SERVICE','KDS']);
    expect(()=>manager.assertDevicePairingAllowed('POS',0)).toThrowError(expect.objectContaining({code:'DEVICE_LIMITS_UNAVAILABLE'}));
    applyLicense(2,'ACTIVE',now+10_000,now+20_000,['CORE_POS','TABLE_SERVICE','KDS'],undefined,{POS:1,WAITER:null,KDS:0});
    expect(()=>manager.assertDevicePairingAllowed('POS',0)).not.toThrow();
    expect(()=>manager.assertDevicePairingAllowed('POS',1)).toThrowError(expect.objectContaining({code:'DEVICE_LIMIT_REACHED'}));
    expect(()=>manager.assertDevicePairingAllowed('WAITER',999)).not.toThrow();
    expect(()=>manager.assertDevicePairingAllowed('KDS',0)).toThrowError(expect.objectContaining({code:'DEVICE_LIMIT_REACHED'}));
  });

  it('applies a signed control response and transmits every durable ACK', async () => {
    const signed = signedControlState();
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const transport = {
      pull: vi.fn().mockResolvedValue(signed.response),
      acknowledge,
    } as unknown as HttpControlTransport;
    const log = { warn: vi.fn() };
    manager = new EdgeLicenseManager(repository, transport, {
      enforcementEnabled: true, publicKeyring: { test: signed.publicKeyPem },
      pullIntervalMs: 300_000, maxBackoffMs: 3_600_000, checkpointIntervalMs: 60_000,
    }, { tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge }, log);

    await manager.pullOnce();

    expect(repository.getRuntime()).toMatchObject({ cloudReachable: true, lastError: null });
    expect(repository.currentDocument<LicenseDocumentPayload>('LICENSE')?.revision).toBe(1);
    expect(acknowledge).toHaveBeenCalledTimes(3);
    expect(database.db.get<{ count: number }>(
      'SELECT count(*) AS count FROM edge_control_ack_outbox WHERE acked_at IS NOT NULL',
    )).toEqual({ count: 3 });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('keeps failed ACKs pending and logs only safe control context', async () => {
    const signed = signedControlState();
    const transport = {
      pull: vi.fn().mockResolvedValue(signed.response),
      acknowledge: vi.fn().mockRejectedValue(
        new ControlTransportError('CONTROL_ACK_HTTP_503', 'ACK_HTTP', 503),
      ),
    } as unknown as HttpControlTransport;
    const log = { warn: vi.fn() };
    manager = new EdgeLicenseManager(repository, transport, {
      enforcementEnabled: true, publicKeyring: { test: signed.publicKeyPem },
      pullIntervalMs: 300_000, maxBackoffMs: 3_600_000, checkpointIntervalMs: 60_000,
    }, { tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge }, log);

    await manager.pullOnce();

    expect(repository.getRuntime().cloudReachable).toBe(true);
    expect(database.db.get<{ count: number }>(
      'SELECT count(*) AS count FROM edge_control_ack_outbox WHERE acked_at IS NULL AND attempt_count=1',
    )).toEqual({ count: 3 });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({
      component: 'edge-control', operation: 'ack', code: 'CONTROL_ACK_HTTP_503',
      stage: 'ACK_HTTP', status: 503, revision: 1,
    }), 'Cloud control-state ACK failed');
  });

  it('logs a safe status and stage when the control pull is rejected', async () => {
    const transport = {
      pull: vi.fn().mockRejectedValue(
        new ControlTransportError('CONTROL_PULL_HTTP_401', 'PULL_HTTP', 401),
      ),
      acknowledge: vi.fn(),
    } as unknown as HttpControlTransport;
    const log = { warn: vi.fn() };
    manager = new EdgeLicenseManager(repository, transport, {
      enforcementEnabled: true, publicKeyring: { test: 'unused' },
      pullIntervalMs: 300_000, maxBackoffMs: 3_600_000, checkpointIntervalMs: 60_000,
    }, { tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge }, log);

    await manager.pullOnce();

    expect(repository.getRuntime()).toMatchObject({
      cloudReachable: false, lastError: 'CONTROL_PULL_HTTP_401',
    });
    expect(log.warn).toHaveBeenCalledWith({
      component: 'edge-control', operation: 'pull', code: 'CONTROL_PULL_HTTP_401',
      stage: 'PULL_HTTP', status: 401,
    }, 'Cloud control-state pull failed');
  });

  function applyLicense(revision: number, state: LicenseDocumentPayload['declaredState'], expiresAt: number,
    graceUntil: number, capabilities: CapabilityCode[] = ['CORE_POS','KDS','PRINTING'],
    protectedCapabilities?: CapabilityCode[],deviceLimits?:LicenseDocumentPayload['deviceLimits']) {
    const payload: LicenseDocumentPayload = {
      documentType: 'LICENSE', formatVersion: 1,
      documentId: `01991a00-2000-7000-8000-${String(100 + revision).padStart(12, '0')}`,
      revision, tenantId: ids.tenant, locationId: ids.location, edgeId: ids.edge,
      issuedAt: new Date(now - 1_000).toISOString(), declaredState: state,
      planCode: 'TEST_ONLY', capabilities,...(deviceLimits?{deviceLimits}:{}),
      expiresAt: new Date(expiresAt).toISOString(), graceUntil: new Date(graceUntil).toISOString(),
    };
    return repository.applyDocument({ payload, envelope: { protected: 'x', payload: 'y', signature: 'z' },
      documentHash: revision.toString().padStart(64, '0'), receivedAt: new Date(now),
      ...(protectedCapabilities ? { protectedCapabilities } : {}) });
  }

  function insertOpenOrder() {
    database.db.run(`INSERT INTO orders
      (id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at)
      VALUES('${ids.order}','${ids.tenant}','${ids.location}','COUNTER','POS','TEST','MXN','OPEN',1,${now})`);
  }

  function insertOpenCashSession(purpose: string, revision: number|null, mode: string|null) {
    database.db.run(`INSERT OR IGNORE INTO cash_registers
      (id,tenant_id,location_id,name,currency,active,blind_cash_count,created_at)
      VALUES('${ids.register}','${ids.tenant}','${ids.location}','Test','MXN',1,1,${now})`);
    database.db.run(`INSERT INTO cash_sessions
      (id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,
       opened_at,opened_by,open_command_id,purpose,opened_license_revision,opened_license_mode)
      VALUES('${ids.session}','${ids.register}','${ids.tenant}','${ids.location}',0,'MXN','2026-08-29','OPEN',
       ${now},'${ids.user}','${randomUUID()}','${purpose}',${revision ?? 'NULL'},${mode ? `'${mode}'` : 'NULL'})`);
  }

  function signedControlState() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const base = {
      formatVersion: 1 as const,
      revision: 1,
      tenantId: ids.tenant,
      locationId: ids.location,
      edgeId: ids.edge,
      issuedAt: new Date(now).toISOString(),
    };
    const license: LicenseDocumentPayload = {
      ...base, documentId: '01991a00-2000-7000-8000-000000000301',
      documentType: 'LICENSE', declaredState: 'ACTIVE', planCode: 'TEST_ONLY',
      capabilities: ['CORE_POS','KDS','PRINTING'],
      expiresAt: new Date(now + 10_000).toISOString(),
      graceUntil: new Date(now + 20_000).toISOString(),
    };
    const featureFlags: FeatureFlagsDocumentPayload = {
      ...base, documentId: '01991a00-2000-7000-8000-000000000302',
      documentType: 'FEATURE_FLAGS', flags: {},
    };
    const configuration: ConfigurationDocumentPayload = {
      ...base, documentId: '01991a00-2000-7000-8000-000000000303',
      documentType: 'CONFIGURATION',
      configuration: { payment: { tipsEnabled: true,
        tipPercentageOptionsBasisPoints: [1000,1500,2000] } },
    };
    const document = (payload: LicenseDocumentPayload | FeatureFlagsDocumentPayload |
      ConfigurationDocumentPayload) => {
      const envelope = signControlDocument(payload, 'test', privateKeyPem);
      return { revision: payload.revision, envelope, documentHash: hashSignedEnvelope(envelope) };
    };
    return {
      publicKeyPem,
      response: {
        desiredControlRevision: 1,
        cloudTime: new Date(now).toISOString(),
        license: document(license),
        featureFlags: document(featureFlags),
        configuration: document(configuration),
      },
    };
  }
});
