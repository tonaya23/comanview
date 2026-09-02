import { describe, expect, it, vi } from 'vitest';
import { createEdgeClient, EdgeClientError, type EdgeFetch, type EdgeResponse } from './index.js';
import {
  clearDeviceIdentity,
  clearDevicePairing,
  createDeviceIdentity,
  createPairingAuthorizationData,
  getDeviceOnboardingState,
  loadDeviceIdentity,
  loadDevicePairing,
  parsePairingAuthorizationData,
  markDeviceAuthorizationStatus,
  rotateDeviceIdentity,
  saveDeviceIdentity,
  saveDevicePairing,
  serializePairingAuthorizationData,
} from './deviceIdentity.js';

function installMemoryIndexedDb(): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const store = {
    get(key: string) { return request(() => values.get(key)); },
    put(value: unknown, key: string) { return request(() => { values.set(key, value); }); },
    delete(key: string) { return request(() => { values.delete(key); }); },
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => {
      const transaction: { objectStore: () => typeof store; error: unknown;
        oncomplete?: () => void; onerror?: () => void; onabort?: () => void } = {
        objectStore: () => store,
        error: null,
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open: () => {
      const result = request(() => database) as ReturnType<typeof request> & { result: typeof database };
      result.result = database;
      return result;
    },
  } });
  return values;
}

function request(run: () => unknown) {
  const result: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void;
    onupgradeneeded?: () => void } = {};
  queueMicrotask(() => {
    try { result.result = run(); result.onupgradeneeded?.(); result.onsuccess?.(); }
    catch (error) { result.error = error; result.onerror?.(); }
  });
  return result;
}

function jsonResponse(body: unknown, status = 200): EdgeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('createEdgeClient', () => {
  it('creates a random UUIDv7 device identity without a fixed credential',()=>{
    const first=createDeviceIdentity('POS','Caja'); const second=createDeviceIdentity('POS','Caja');
    expect(first.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.credential).toHaveLength(43);
    expect(second.credential).not.toBe(first.credential);
  });
  it('persists Device identity and private pairing proof in IndexedDB without coupling it to logout',async()=>{
    installMemoryIndexedDb();
    const localStorageWrites=vi.fn();
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{setItem:localStorageWrites}});
    const identity=createDeviceIdentity('POS','Caja principal');
    const pairing={pairingId:'01991a00-0000-7000-8000-000000000401',requestToken:'r'.repeat(43),
      pairingCode:'123456',expiresAt:'2026-08-29T12:10:00.000Z',deviceId:identity.deviceId,
      currentStatus:'PENDING' as const};
    await saveDeviceIdentity(identity);await expect(saveDevicePairing(pairing)).resolves.toBe(true);
    await expect(loadDeviceIdentity()).resolves.toEqual(identity);
    await expect(loadDevicePairing()).resolves.toEqual(pairing);
    await clearDevicePairing();
    await expect(loadDeviceIdentity()).resolves.toEqual(identity);
    await clearDeviceIdentity();
    await expect(loadDeviceIdentity()).resolves.toBeNull();
    expect(localStorageWrites).not.toHaveBeenCalled();
  });
  it('persists only the authoritative Device authorization state after pairing proof cleanup',async()=>{
    installMemoryIndexedDb();
    const identity=createDeviceIdentity('POS','Caja principal');
    await saveDeviceIdentity(identity);
    await expect(markDeviceAuthorizationStatus(identity.deviceId,'ACTIVE')).resolves.toMatchObject({authorizationStatus:'ACTIVE'});
    await expect(loadDeviceIdentity()).resolves.toMatchObject({deviceId:identity.deviceId,authorizationStatus:'ACTIVE'});
    expect(getDeviceOnboardingState(await loadDeviceIdentity(),null)).toBe('ACTIVE');
    expect(getDeviceOnboardingState({...identity,authorizationStatus:'REVOKED'},null)).toBe('REVOKED');
    expect(getDeviceOnboardingState(identity,null)).toBe('UNREGISTERED');
    expect(getDeviceOnboardingState(identity,{currentStatus:'PENDING'})).toBe('PENDING');
  });
  it('does not restore an old pairing after a storage wipe creates a new Device identity',async()=>{
    const storage=installMemoryIndexedDb();
    const oldIdentity=createDeviceIdentity('POS','POS principal');
    const oldPairing={pairingId:'01991a00-0000-7000-8000-000000000411',requestToken:'r'.repeat(43),
      pairingCode:'123456',expiresAt:'2026-08-29T12:10:00.000Z',deviceId:oldIdentity.deviceId,
      currentStatus:'PENDING' as const};
    await saveDeviceIdentity(oldIdentity);await expect(saveDevicePairing(oldPairing)).resolves.toBe(true);
    storage.clear();
    await expect(loadDeviceIdentity()).resolves.toBeNull();
    await expect(loadDevicePairing()).resolves.toBeNull();
    const replacement=createDeviceIdentity('POS','POS principal');
    await saveDeviceIdentity(replacement);
    expect(replacement.deviceId).not.toBe(oldIdentity.deviceId);
    expect(replacement.credential).not.toBe(oldIdentity.credential);
    await expect(saveDevicePairing(oldPairing)).resolves.toBe(false);
    await expect(loadDevicePairing()).resolves.toBeNull();
  });
  it('atomically replaces a revoked identity and removes only its stale pairing',async()=>{
    const storage=installMemoryIndexedDb();
    const revoked=createDeviceIdentity('POS','POS principal');
    const stalePairing={pairingId:'01991a00-0000-7000-8000-000000000431',requestToken:'r'.repeat(43),
      pairingCode:'123456',expiresAt:'2026-08-29T12:10:00.000Z',deviceId:revoked.deviceId,
      currentStatus:'ACTIVE' as const};
    await saveDeviceIdentity(revoked);await expect(saveDevicePairing(stalePairing)).resolves.toBe(true);
    storage.set('unrelated',{preserved:true});

    const replacement=await rotateDeviceIdentity(revoked.deviceId);

    expect(replacement?.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(replacement?.deviceId).not.toBe(revoked.deviceId);
    expect(replacement?.credential).toHaveLength(43);
    expect(replacement?.credential).not.toBe(revoked.credential);
    await expect(loadDeviceIdentity()).resolves.toEqual(replacement);
    await expect(loadDevicePairing()).resolves.toBeNull();
    expect(storage.get('unrelated')).toEqual({preserved:true});
  });
  it('does not overwrite a newer identity when the expected revoked identity is stale',async()=>{
    installMemoryIndexedDb();
    const revoked=createDeviceIdentity('POS','POS principal');
    const current=createDeviceIdentity('POS','POS principal');
    await saveDeviceIdentity(current);

    await expect(rotateDeviceIdentity(revoked.deviceId)).resolves.toBeNull();
    await expect(loadDeviceIdentity()).resolves.toEqual(current);
  });
  it('does not let a stale poll overwrite a newer pairing for the same Device identity',async()=>{
    installMemoryIndexedDb();
    const identity=createDeviceIdentity('POS','POS principal');
    const previous={pairingId:'01991a00-0000-7000-8000-000000000421',requestToken:'r'.repeat(43),
      pairingCode:'123456',expiresAt:'2026-08-29T12:10:00.000Z',deviceId:identity.deviceId,
      currentStatus:'PENDING' as const};
    const current={...previous,pairingId:'01991a00-0000-7000-8000-000000000422',pairingCode:'654321'};
    await saveDeviceIdentity(identity);
    await expect(saveDevicePairing(previous)).resolves.toBe(true);
    await expect(saveDevicePairing(current)).resolves.toBe(true);
    await expect(saveDevicePairing({...previous,currentStatus:'ACTIVE'},previous.pairingId)).resolves.toBe(false);
    await expect(loadDevicePairing()).resolves.toEqual(current);
  });
  it('round-trips the exact public pairing bindings without private Device proof',()=>{
    const identity={deviceId:'01991a00-0000-7000-8000-000000000402',credential:'private-device-credential',
      type:'POS' as const,displayName:'POS principal'};
    const pairing={pairingId:'01991a00-0000-7000-8000-000000000401',requestToken:'private-request-token',
      pairingCode:'123456',expiresAt:'2026-08-29T12:10:00.000Z',deviceId:identity.deviceId,
      currentStatus:'PENDING' as const};
    const transfer=createPairingAuthorizationData(pairing,identity);
    const serialized=serializePairingAuthorizationData(transfer);
    expect(parsePairingAuthorizationData(serialized)).toEqual({schemaVersion:1,
      pairingId:pairing.pairingId,pairingCode:pairing.pairingCode,deviceId:identity.deviceId,
      deviceType:'POS',displayName:'POS principal'});
    expect(serialized).not.toContain(identity.credential);
    expect(serialized).not.toContain(pairing.requestToken);
  });
  it('keeps PIN login unauthenticated and sends the opaque session token afterwards', async () => {
    let token: string | null = null;
    const fetchMock = vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
      if (input.endsWith('/auth/login')) {
        return jsonResponse({
          token: 'opaque-local-session-token-with-sufficient-length',
          user: {
            id: '01991a00-0000-7000-8000-000000000712',
            displayName: 'Cajero desarrollo',
            status: 'ACTIVE',
            roles: ['CASHIER'],
            permissions: ['ORDER_CREATE'],
          },
          session: {
            id: '01991a00-0000-7000-8000-000000000799',
            deviceId: '01991a00-0000-7000-8000-000000000721',
            loginAt: '2026-08-27T12:00:00.000Z',
            lastActivity: '2026-08-27T12:00:00.000Z',
            expiresAt: '2026-08-28T00:00:00.000Z',
          },
        });
      }
      expect(init?.headers?.['authorization']).toBe(`Bearer ${token}`);
      return jsonResponse({
        user: {
          id: '01991a00-0000-7000-8000-000000000712',
          displayName: 'Cajero desarrollo',
          status: 'ACTIVE',
          roles: ['CASHIER'],
          permissions: ['ORDER_CREATE'],
        },
        session: {
          id: '01991a00-0000-7000-8000-000000000799',
          deviceId: '01991a00-0000-7000-8000-000000000721',
          loginAt: '2026-08-27T12:00:00.000Z',
          lastActivity: '2026-08-27T12:00:00.000Z',
          expiresAt: '2026-08-28T00:00:00.000Z',
        },
      });
    });
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000',
      fetch: fetchMock as EdgeFetch,
      getAccessToken: () => token,
    });

    const loggedIn = await client.login({
      pin: '2222',
      deviceId: '01991a00-0000-7000-8000-000000000721',
      deviceCredential: 'comanview-development-pos-device-credential-0001',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    token = loggedIn.token;
    await client.getCurrentSession();
  });

  it('preserves the current Bearer token when adding JSON content headers', async () => {
    const token = 'current-local-session-token';
    const fetchMock = vi.fn(async (_input: string, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers).toEqual({
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      });
      return jsonResponse(
        {
          id: '01991a00-0000-7000-8000-000000000731',
          cashRegisterId: '01991a00-0000-7000-8000-000000000601',
          status: 'OPEN',
          purpose: 'NORMAL',
          openingFloat: { amount: 1000, currency: 'MXN' },
          expectedCash: { amount: 1000, currency: 'MXN' },
          blindCashCount: false,
          businessDate: '2026-08-27',
          openedAt: '2026-08-27T12:00:00.000Z',
          openedBy: '01991a00-0000-7000-8000-000000000712',
          closedAt: null,
          closedBy: null,
          countedCash: null,
          expectedCashAtClose: null,
          difference: null,
        },
        201,
      );
    });
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000',
      fetch: fetchMock as EdgeFetch,
      getAccessToken: () => token,
    });

    await client.openCashSession({
      commandId: 'sdk-auth-open-cash',
      openingFloatAmount: 1000,
      businessDate: '2026-08-27',
    });
  });

  it('sends the current Bearer token when requesting installation readiness', async () => {
    let token = 'stale-session-token';
    const fetchMock = vi.fn(async (_input: string, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers?.['authorization']).toBe('Bearer current-session-token');
      return jsonResponse({
        technicalHealth: 'READY',
        operationalReadiness: 'READY',
        productionReadiness: 'NOT_READY',
        licensingStatus: 'VALID',
        components: [],
      });
    });
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000',
      fetch: fetchMock as EdgeFetch,
      getAccessToken: () => token,
    });

    token = 'current-session-token';
    await expect(client.getInstallationReadiness()).resolves.toMatchObject({
      technicalHealth: 'READY',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/installation/readiness',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer current-session-token' }),
      }),
    );
  });

  it('cancels a pairing through the authenticated local administration route', async () => {
    const fetchMock = vi.fn(async (input: string, init?: { headers?: Record<string, string>; body?: string }) => {
      expect(input).toBe('http://localhost:3000/device-pairing/01991a00-0000-7000-8000-000000000401/cancel');
      expect(init).toMatchObject({ method: 'POST', body: expect.any(String) });
      expect(init?.headers?.['authorization']).toBe('Bearer owner-session');
      return jsonResponse({ cancelled: true });
    });
    const client = createEdgeClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock as EdgeFetch,
      getAccessToken: () => 'owner-session' });

    await expect(client.cancelPairing('01991a00-0000-7000-8000-000000000401', {
      commandId: '01991a00-0000-7000-8000-000000000499',
    })).resolves.toEqual({ cancelled: true });
  });

  it('uses Bearer for normal restore but keeps the localhost emergency recovery request token-free',async()=>{
    const fetchMock=vi.fn(async(input:string,init?:{headers?:Record<string,string>})=>{
      if(input.endsWith('/recovery/restore'))expect(init?.headers?.['authorization']).toBe('Bearer owner-session');
      else expect(init?.headers?.['authorization']).toBeUndefined();
      return jsonResponse({scheduled:true,recoveryState:'RECOVERY_IN_PROGRESS'},202);
    });
    const client=createEdgeClient({baseUrl:'http://localhost:3000',fetch:fetchMock as EdgeFetch,getAccessToken:()=> 'owner-session'});
    const common={commandId:'01991a00-0000-7000-8000-000000000501',backupId:'01991a00-0000-7000-8000-000000000502',confirmation:'RESTORE_VERIFIED_BACKUP' as const};
    await client.restoreBackup(common);await client.emergencyRestore({...common,artifactPath:'C:\\Backups\\backup.cvbackup',recoveryKey:'a'.repeat(43)});
  });

  it('requests and validates the Edge health endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 'UP',
        edgeService: { status: 'OK', timestamp: '2026-08-25T12:00:00.000Z' },
        database: { status: 'OK' },
      }),
    );
    const client = createEdgeClient({
      baseUrl: 'http://localhost:3000/',
      fetch: fetchMock as EdgeFetch,
    });

    await expect(client.getHealth()).resolves.toMatchObject({ status: 'UP' });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/health', expect.any(Object));
  });

  it('sends the current version when removing a DRAFT item', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: '01991a00-0000-7000-8000-000000000301',
        tenantId: '01991a00-0000-7000-8000-000000000302',
        locationId: '01991a00-0000-7000-8000-000000000303',
        orderType: 'COUNTER',
        channel: 'POS',
        currency: 'MXN',
        status: 'OPEN',
        tableIds: [],
        items: [],
        rounds: [],
        subtotal: { amount: 0, currency: 'MXN' },
        total: { amount: 0, currency: 'MXN' },
        paidAmount: { amount: 0, currency: 'MXN' },
        balanceDue: { amount: 0, currency: 'MXN' },
        tipTotal: { amount: 0, currency: 'MXN' },
        payments: [],
        version: 4,
        createdAt: '2026-08-25T12:00:00.000Z',
        updatedAt: '2026-08-25T12:00:00.000Z',
      }),
    );
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.removeOrderItem(
      '01991a00-0000-7000-8000-000000000301',
      '01991a00-0000-7000-8000-000000000304',
      { expectedVersion: 3 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/orders/01991a00-0000-7000-8000-000000000301/items/01991a00-0000-7000-8000-000000000304',
      expect.objectContaining({ method: 'DELETE', body: '{"expectedVersion":3}' }),
    );
  });

  it('sends a versioned idempotent special-instructions command', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      payments: [],
      version: 4,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    const request = {
      commandId: 'note-command',
      expectedVersion: 3,
      specialInstructions: 'salsa aparte',
    };

    await client.updateOrderItemSpecialInstructions(
      order.id,
      '01991a00-0000-7000-8000-000000000304',
      request,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/items/01991a00-0000-7000-8000-000000000304/instructions`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(request) }),
    );
  });

  it('sends an authoritative DRAFT configuration edit command', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      payments: [],
      version: 5,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    const request = {
      commandId: 'configuration-command',
      expectedVersion: 4,
      selectedModifierIds: ['01991a00-0000-7000-8000-000000000401'],
      specialInstructions: 'sin cebolla',
    };

    await client.updateDraftOrderItemConfiguration(
      order.id,
      '01991a00-0000-7000-8000-000000000304',
      request,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/items/01991a00-0000-7000-8000-000000000304/configuration`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(request) }),
    );
  });

  it('exposes stable Edge error codes', async () => {
    const client = createEdgeClient({
      fetch: vi.fn(async () =>
        jsonResponse({ error: 'STALE_ORDER_VERSION', message: 'Order changed' }, 409),
      ) as EdgeFetch,
    });

    await expect(client.getOrder('order-id')).rejects.toMatchObject({
      code: 'STALE_ORDER_VERSION',
      status: 409,
    } satisfies Partial<EdgeClientError>);
  });

  it('sends exact payment intent without deriving financial values', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      payments: [],
      version: 2,
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.createPayment(order.id, {
      commandId: 'payment-command',
      expectedVersion: 1,
      method: 'CASH',
      amountApplied: 105,
      tip: { type: 'PERCENTAGE', basisPoints: 1000 },
      cashTendered: 120,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/payments`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          commandId: 'payment-command',
          expectedVersion: 1,
          method: 'CASH',
          amountApplied: 105,
          tip: { type: 'PERCENTAGE', basisPoints: 1000 },
          cashTendered: 120,
        }),
      }),
    );
  });

  it('sends the reason and one-operation override PIN only in the void request body', async () => {
    const order = {
      id: '01991a00-0000-7000-8000-000000000301',
      tenantId: '01991a00-0000-7000-8000-000000000302',
      locationId: '01991a00-0000-7000-8000-000000000303',
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [],
      items: [],
      rounds: [],
      payments: [],
      version: 3,
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async () => jsonResponse(order));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    const request = {
      commandId: 'void-command',
      expectedVersion: 2,
      reason: 'Cobro duplicado',
      overridePin: '5555',
    };

    await client.voidPayment(order.id, '01991a00-0000-7000-8000-000000000701', request);

    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${order.id}/payments/01991a00-0000-7000-8000-000000000701/void`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    );
  });

  it('queries the durable audit log with typed filters', async () => {
    const response = { entries: [] };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });

    await client.getAuditEntries({
      action: 'PAYMENT_VOIDED',
      actorUserId: '01991a00-0000-7000-8000-000000000801',
      resourceId: '01991a00-0000-7000-8000-000000000802',
      from: '2026-08-27T12:00:00.000Z',
      to: '2026-08-27T13:00:00.000Z',
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/audit?action=PAYMENT_VOIDED&actorUserId=01991a00-0000-7000-8000-000000000801&resourceId=01991a00-0000-7000-8000-000000000802&from=2026-08-27T12%3A00%3A00.000Z&to=2026-08-27T13%3A00%3A00.000Z&limit=25',
      {},
    );
  });

  it('requests durable print jobs with an idempotency command', async () => {
    const job = {
      printJobId: '01991a00-0000-7000-8000-000000000901',
      orderId: '01991a00-0000-7000-8000-000000000301',
      cashSessionId: null,
      roundId: null,
      stationId: null,
      targetId: '01991a00-0000-7000-8000-000000000902',
      jobType: 'PRECHECK',
      status: 'PENDING',
      attempts: 0,
      createdAt: '2026-08-26T12:00:00.000Z',
      updatedAt: '2026-08-26T12:00:00.000Z',
      lastError: null,
    };
    const fetchMock = vi.fn(async () => jsonResponse(job, 201));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    await client.requestPrecheck(job.orderId, { commandId: 'print-command' });
    expect(fetchMock).toHaveBeenCalledWith(
      `/orders/${job.orderId}/precheck`,
      expect.objectContaining({ method: 'POST', body: '{"commandId":"print-command"}' }),
    );
  });

  it('queries and advances KDS tickets through Edge', async () => {
    const ticket = {
      ticketId: 'round:station',
      orderId: '01991a00-0000-7000-8000-000000000301',
      orderNumber: 'K-1',
      orderType: 'COUNTER',
      roundId: '01991a00-0000-7000-8000-000000000302',
      roundNumber: 1,
      stationId: '01991a00-0000-7000-8000-000000000501',
      stationName: 'COCINA',
      status: 'PREPARING',
      sentAt: '2026-08-26T12:00:00.000Z',
      preparingAt: '2026-08-26T12:01:00.000Z',
      readyAt: null,
      items: [
        {
          orderItemId: '01991a00-0000-7000-8000-000000000601',
          quantity: 1,
          productName: 'Hamburguesa',
          modifiers: [],
          specialInstructions: null,
          prepStatus: 'PREPARING',
        },
      ],
    };
    const fetchMock = vi.fn(async () => jsonResponse(ticket));
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    await client.startKdsTicket(ticket.roundId, ticket.stationId, { commandId: 'start-kds' });
    expect(fetchMock).toHaveBeenCalledWith(
      `/kds/tickets/${ticket.roundId}/${ticket.stationId}/preparing`,
      expect.objectContaining({ method: 'POST', body: '{"commandId":"start-kds"}' }),
    );
  });

  it('lists tables and sends an explicit idempotent table move command', async () => {
    const table = {
      id: '01991a00-0000-7000-8000-000000000801',
      locationId: '01991a00-0000-7000-8000-000000000302',
      name: 'Mesa 1',
      zone: 'SALÓN',
      capacity: 4,
      displayOrder: 10,
      active: true,
      status: 'FREE',
      activeOrderId: null,
      activeOrderNumber: null,
    };
    const order = {
      id: '01991a00-0000-7000-8000-000000000901',
      tenantId: '01991a00-0000-7000-8000-000000000301',
      locationId: table.locationId,
      orderType: 'TABLE',
      channel: 'WAITER',
      currency: 'MXN',
      status: 'OPEN',
      tableIds: [table.id],
      items: [],
      rounds: [],
      payments: [],
      version: 2,
      subtotal: { amount: 0, currency: 'MXN' },
      total: { amount: 0, currency: 'MXN' },
      paidAmount: { amount: 0, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 0, currency: 'MXN' },
      createdAt: '2026-08-27T12:00:00.000Z',
      updatedAt: '2026-08-27T12:00:00.000Z',
    };
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse(url === '/tables' ? [table] : order),
    );
    const client = createEdgeClient({ fetch: fetchMock as EdgeFetch });
    expect(await client.getTables()).toMatchObject([table]);
    const move = { commandId: 'move-order', expectedVersion: 1, tableIds: [table.id] };
    await client.updateOrderTables(order.id, move);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/tables`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(move) }),
    );
    const cancellation = { commandId: 'cancel-empty-table', expectedVersion: order.version };
    await client.cancelEmptyTableOrder(order.id, cancellation);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/cancel-empty`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(cancellation) }),
    );
    const requestPayment = { commandId: 'request-payment', expectedVersion: order.version };
    await client.requestOrderPayment(order.id, requestPayment);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/orders/${order.id}/payment-request`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(requestPayment) }),
    );
  });
});
