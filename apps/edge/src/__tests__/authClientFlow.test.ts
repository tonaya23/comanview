import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEdgeClient } from '@comanview/client-sdk';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { buildApp } from '../index.js';

const POS_DEVICE_ID = '01991a00-0000-7000-8000-000000000721';
const CASHIER_ID = '01991a00-0000-7000-8000-000000000712';

describe('authenticated client-sdk flow against real Edge and SQLite', () => {
  const dbPath = join(tmpdir(), `comanview-auth-client-${Date.now()}.db`);
  let app: FastifyInstance;
  let baseUrl = '';

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    app = await buildApp(dbPath, { startPrintWorker: false });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('keeps one CASHIER session through cash, sale, payment and logout', async () => {
    let sessionToken: string | null = null;
    const client = createEdgeClient({ baseUrl, getAccessToken: () => sessionToken });

    const login = await client.login({ pin: '2222', deviceId: POS_DEVICE_ID });
    sessionToken = login.token;
    expect((await client.getCurrentSession()).user.id).toBe(CASHIER_ID);
    expect((await client.getCurrentCashSession()).session).toBeNull();

    const cashSession = await client.openCashSession({
      commandId: 'sdk-edge-open-cash',
      openingFloatAmount: 1000,
      businessDate: '2026-08-27',
    });
    expect(cashSession.openedBy).toBe(CASHIER_ID);

    const products = await client.getProducts();
    const water = products.find(({ name }) => name === 'Agua mineral')!;
    const created = await client.createOrder({
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
    });
    const added = await client.addOrderItem(created.id, {
      commandId: 'sdk-edge-add-water',
      expectedVersion: created.version,
      productId: water.id,
    });
    const sent = await client.sendRound(created.id, {
      commandId: 'sdk-edge-send-round',
      expectedVersion: added.version,
    });
    const paid = await client.createPayment(created.id, {
      commandId: 'sdk-edge-payment',
      expectedVersion: sent.version,
      method: 'CASH',
      amountApplied: 3200,
      tip: { type: 'NONE' },
      cashTendered: 3200,
    });
    const closed = await client.closeOrder(created.id, {
      commandId: 'sdk-edge-close',
      expectedVersion: paid.version,
    });
    expect(closed.status).toBe('CLOSED');

    const restoredClient = createEdgeClient({ baseUrl, getAccessToken: () => sessionToken });
    expect((await restoredClient.getCurrentSession()).user.id).toBe(CASHIER_ID);
    expect((await restoredClient.getOrder(created.id)).status).toBe('CLOSED');

    const oldToken = sessionToken;
    await client.logout();
    sessionToken = oldToken;
    await expect(client.getCurrentCashSession()).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_SESSION_INVALID',
    });
  });
});
