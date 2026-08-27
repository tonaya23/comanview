import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AuthRepository,
  createEdgeDatabase,
  prepareDevelopmentDatabase,
} from '@comanview/database';
import { authSessions } from '@comanview/database/edge';
import { buildApp } from '../index.js';

const POS_DEVICE_ID = '01991a00-0000-7000-8000-000000000721';
const KDS_DEVICE_ID = '01991a00-0000-7000-8000-000000000722';

describe('offline local Auth and RBAC', () => {
  const dbPath = join(tmpdir(), `comanview-auth-${Date.now()}.db`);
  let app: FastifyInstance;
  let cashierToken = '';
  let waiterToken = '';
  let ownerToken = '';
  let kitchenToken = '';

  const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

  async function login(pin: string, deviceId = POS_DEVICE_ID) {
    return app.inject({ method: 'POST', url: '/auth/login', payload: { pin, deviceId } });
  }

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    app = await buildApp(dbPath, { startPrintWorker: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('validates PIN locally, rejects wrong/inactive users, and never exposes credentials', async () => {
    const wrong = await login('0000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('INVALID_CREDENTIALS');

    const inactive = await login('9999');
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json().error).toBe('INVALID_CREDENTIALS');

    const cashier = await login('2222');
    expect(cashier.statusCode).toBe(200);
    cashierToken = cashier.json().token;
    expect(cashier.json().user).toMatchObject({
      displayName: 'Cajero desarrollo',
      roles: ['CASHIER'],
    });
    expect(JSON.stringify(cashier.json())).not.toContain('pin');
    expect(JSON.stringify(cashier.json())).not.toContain('hash');

    const inspection = createEdgeDatabase(dbPath);
    const persisted = new AuthRepository(inspection.db)
      .listUsersForLogin(
        '01991a00-0000-7000-8000-000000000301',
        '01991a00-0000-7000-8000-000000000302',
      )
      .find((user) => user.displayName === 'Cajero desarrollo')!;
    expect(persisted.pinHash).not.toBe('2222');
    expect(persisted.pinHash).toMatch(/^scrypt-v1\$/);
    const persistedSession = inspection.db
      .select({ tokenHash: authSessions.tokenHash })
      .from(authSessions)
      .get()!;
    expect(persistedSession.tokenHash).not.toBe(cashierToken);
    expect(persistedSession.tokenHash).toHaveLength(64);
    inspection.close();
  });

  it('returns 401 without a valid session and restores a persisted session after Edge restart', async () => {
    const noSession = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        orderType: 'COUNTER',
        channel: 'POS',
        currency: 'MXN',
      },
    });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json().error).toBe('AUTHENTICATION_REQUIRED');

    const invalid = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: authorized('not-a-real-session-token'),
    });
    expect(invalid.statusCode).toBe(401);

    const current = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: authorized(cashierToken),
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().user.displayName).toBe('Cajero desarrollo');

    await app.close();
    app = await buildApp(dbPath, { startPrintWorker: false });
    await app.ready();
    const restored = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: authorized(cashierToken),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().user.displayName).toBe('Cajero desarrollo');
  });

  it('enforces permissions with 403 across Cash, Payments, close, Printing and KDS', async () => {
    const waiter = await login('3333');
    waiterToken = waiter.json().token;
    const order = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: authorized(waiterToken),
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    expect(order.statusCode).toBe(201);

    const deniedRequests = [
      app.inject({
        method: 'POST',
        url: '/cash-sessions',
        headers: authorized(waiterToken),
        payload: {
          commandId: 'auth-denied-cash',
          openingFloatAmount: 0,
          businessDate: '2026-08-27',
        },
      }),
      app.inject({
        method: 'POST',
        url: `/orders/${order.json().id}/payments`,
        headers: authorized(waiterToken),
        payload: {
          commandId: 'auth-denied-payment',
          expectedVersion: order.json().version,
          method: 'CASH',
          amountApplied: 1,
          tip: { type: 'NONE' },
          cashTendered: 1,
        },
      }),
      app.inject({
        method: 'POST',
        url: `/orders/${order.json().id}/close`,
        headers: authorized(waiterToken),
        payload: { commandId: 'auth-denied-close', expectedVersion: order.json().version },
      }),
      app.inject({
        method: 'POST',
        url: `/orders/${order.json().id}/receipt`,
        headers: authorized(waiterToken),
        payload: { commandId: 'auth-denied-print' },
      }),
      app.inject({
        method: 'POST',
        url: `/kds/tickets/${order.json().id}/${order.json().id}/ready`,
        headers: authorized(waiterToken),
        payload: { commandId: 'auth-denied-kds' },
      }),
    ];
    for (const response of await Promise.all(deniedRequests)) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('PERMISSION_DENIED');
    }
    const overrideRequired = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/payments/${order.json().id}/void`,
      headers: authorized(waiterToken),
      payload: {
        commandId: 'auth-denied-void',
        expectedVersion: order.json().version,
        reason: 'Prueba de autorización',
      },
    });
    expect(overrideRequired.statusCode).toBe(403);
    expect(overrideRequired.json().error).toBe('OVERRIDE_REQUIRED');
  });

  it('allows authorized cashier and kitchen operations while Edge remains fully local', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/cash-sessions',
      headers: authorized(cashierToken),
      payload: {
        commandId: 'auth-open-cash',
        openingFloatAmount: 1000,
        businessDate: '2026-08-27',
      },
    });
    expect(opened.statusCode).toBe(201);
    expect(opened.json().openedBy).toBe('01991a00-0000-7000-8000-000000000712');

    const products = await app.inject({
      method: 'GET',
      url: '/catalog/products',
      headers: authorized(cashierToken),
    });
    const water = products.json().find((product: any) => product.name === 'Agua mineral');
    const order = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: authorized(cashierToken),
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/items`,
      headers: authorized(cashierToken),
      payload: {
        commandId: 'auth-add-water',
        expectedVersion: order.json().version,
        productId: water.id,
      },
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/rounds`,
      headers: authorized(cashierToken),
      payload: { commandId: 'auth-send-round', expectedVersion: added.json().version },
    });
    expect(sent.statusCode).toBe(200);

    const precheck = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/precheck`,
      headers: authorized(cashierToken),
      payload: { commandId: 'auth-precheck' },
    });
    expect(precheck.statusCode).toBe(201);

    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/payments`,
      headers: authorized(cashierToken),
      payload: {
        commandId: 'auth-payment',
        expectedVersion: sent.json().version,
        method: 'CASH',
        amountApplied: 3200,
        tip: { type: 'NONE' },
        cashTendered: 3200,
      },
    });
    expect(paid.statusCode).toBe(200);
    const closed = await app.inject({
      method: 'POST',
      url: `/orders/${order.json().id}/close`,
      headers: authorized(cashierToken),
      payload: { commandId: 'auth-close', expectedVersion: paid.json().version },
    });
    expect(closed.statusCode).toBe(200);

    const owner = await login('1111');
    ownerToken = owner.json().token;
    const voidOrder = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: authorized(ownerToken),
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const voidItem = await app.inject({
      method: 'POST',
      url: `/orders/${voidOrder.json().id}/items`,
      headers: authorized(ownerToken),
      payload: {
        commandId: 'auth-void-add',
        expectedVersion: voidOrder.json().version,
        productId: water.id,
      },
    });
    const partialPayment = await app.inject({
      method: 'POST',
      url: `/orders/${voidOrder.json().id}/payments`,
      headers: authorized(ownerToken),
      payload: {
        commandId: 'auth-void-payment',
        expectedVersion: voidItem.json().version,
        method: 'CASH',
        amountApplied: 1000,
        tip: { type: 'NONE' },
        cashTendered: 1000,
      },
    });
    const voided = await app.inject({
      method: 'POST',
      url: `/orders/${voidOrder.json().id}/payments/${partialPayment.json().payments[0].id}/void`,
      headers: authorized(ownerToken),
      payload: {
        commandId: 'auth-payment-void',
        expectedVersion: partialPayment.json().version,
        reason: 'Pago registrado por error',
      },
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().payments[0].status).toBe('VOIDED');

    const kitchen = await login('4444', KDS_DEVICE_ID);
    kitchenToken = kitchen.json().token;
    const stations = await app.inject({
      method: 'GET',
      url: '/kds/stations',
      headers: authorized(kitchenToken),
    });
    const bar = stations.json().find((station: any) => station.name === 'BARRA');
    const tickets = await app.inject({
      method: 'GET',
      url: `/kds/tickets?stationId=${bar.stationId}`,
      headers: authorized(kitchenToken),
    });
    const ticket = tickets.json()[0];
    const preparing = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${ticket.roundId}/${bar.stationId}/preparing`,
      headers: authorized(kitchenToken),
      payload: { commandId: 'auth-kds-preparing' },
    });
    expect(preparing.statusCode).toBe(200);
  });

  it('authenticates KDS realtime with the local session and closes it after revocation', async () => {
    const anonymous = await app.injectWS('/realtime');
    const anonymousClosed = new Promise<number>((resolve) =>
      anonymous.once('close', (code: number) => resolve(code)),
    );
    anonymous.send(JSON.stringify({ type: 'AUTHENTICATE', token: 'invalid-session-token' }));
    await expect(anonymousClosed).resolves.toBe(1008);

    const socket = await app.injectWS('/realtime');
    const authenticated = new Promise<unknown>((resolve) =>
      socket.once('message', (payload: Buffer) => resolve(JSON.parse(payload.toString()))),
    );
    socket.send(JSON.stringify({ type: 'AUTHENTICATE', token: kitchenToken }));
    await expect(authenticated).resolves.toEqual({ type: 'AUTHENTICATED' });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: authorized(kitchenToken),
    });
    expect(logout.statusCode).toBe(200);

    const stations = await app.inject({
      method: 'GET',
      url: '/kds/stations',
      headers: authorized(ownerToken),
    });
    const bar = stations.json().find((station: any) => station.name === 'BARRA');
    const tickets = await app.inject({
      method: 'GET',
      url: `/kds/tickets?stationId=${bar.stationId}`,
      headers: authorized(ownerToken),
    });
    const ticket = tickets.json()[0];
    const transitionTarget = ticket.status === 'PREPARING' ? 'ready' : 'preparing';
    const revokedClosed = new Promise<number>((resolve) =>
      socket.once('close', (code: number) => resolve(code)),
    );
    const transition = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${ticket.roundId}/${bar.stationId}/${transitionTarget}`,
      headers: authorized(ownerToken),
      payload: { commandId: 'auth-kds-revoked-socket' },
    });
    expect(transition.statusCode).toBe(200);
    await expect(revokedClosed).resolves.toBe(1008);
  });

  it('revokes logout immediately and rejects the session afterwards', async () => {
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: authorized(ownerToken),
    });
    expect(logout.statusCode).toBe(200);
    const rejected = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: authorized(ownerToken),
    });
    expect(rejected.statusCode).toBe(401);
  });

  it('temporarily locks repeated PIN guessing per local device', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await login('0000', KDS_DEVICE_ID);
      expect(rejected.statusCode).toBe(401);
    }
    const locked = await login('0000', KDS_DEVICE_ID);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('AUTH_TEMPORARILY_LOCKED');
  });
});
