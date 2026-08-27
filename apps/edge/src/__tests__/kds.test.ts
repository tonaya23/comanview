import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { PrinterAdapterError } from '@comanview/printing';
import { buildApp } from '../index.js';

describe('KDS vertical slice', () => {
  const dbPath = join(tmpdir(), `comanview-kds-api-${Date.now()}.db`);
  let app: FastifyInstance;
  let orderId = '';
  let roundId = '';
  let kitchenId = '';
  let barId = '';
  let orderVersion = 0;

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    app = await buildApp(dbPath, {
      printerAdapter: {
        print: async () => {
          throw new PrinterAdapterError('printer offline', 'NOT_STARTED');
        },
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('routes one Round into data-driven station tickets and emits realtime after commit', async () => {
    const stations = (await app.inject({ method: 'GET', url: '/kds/stations' })).json();
    kitchenId = stations.find((station: any) => station.name === 'COCINA').stationId;
    barId = stations.find((station: any) => station.name === 'BARRA').stationId;
    const products = (await app.inject({ method: 'GET', url: '/catalog/products' })).json();
    const burger = products.find((product: any) => product.name === 'Hamburguesa clásica');
    const lemonade = products.find((product: any) => product.name === 'Limonada');
    const water = products.find((product: any) => product.name === 'Agua mineral');
    const doneness = burger.modifierGroups.find(
      (group: any) => group.modifierGroup.name === 'Término',
    ).modifierGroup.options[0];
    const socket = await app.injectWS('/realtime');
    const realtime = new Promise<any>((resolve) =>
      socket.once('message', (payload: Buffer) => resolve(JSON.parse(payload.toString()))),
    );

    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    orderId = created.json().id;
    let version = created.json().version;
    for (const [commandId, productId, extra] of [
      [
        '01991a00-3000-7000-8000-000000000001',
        burger.id,
        { selectedModifierIds: [doneness.id], specialInstructions: 'solo una rodaja de tomate' },
      ],
      ['01991a00-3000-7000-8000-000000000002', lemonade.id, {}],
      ['01991a00-3000-7000-8000-000000000003', water.id, {}],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/orders/${orderId}/items`,
        payload: { commandId, expectedVersion: version, productId, ...extra },
      });
      expect(response.statusCode).toBe(200);
      version = response.json().version;
    }
    const sendCommand = '01991a00-3000-7000-8000-000000000004';
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: { commandId: sendCommand, expectedVersion: version },
    });
    expect(sent.statusCode).toBe(200);
    roundId = sent.json().rounds[0].id;
    orderVersion = sent.json().version;
    await expect(realtime).resolves.toMatchObject({
      type: 'KDS_TICKETS_CHANGED',
      reason: 'ROUND_SENT',
      stationIds: expect.arrayContaining([kitchenId, barId]),
    });

    const kitchen = (
      await app.inject({ method: 'GET', url: `/kds/tickets?stationId=${kitchenId}` })
    ).json();
    const bar = (
      await app.inject({ method: 'GET', url: `/kds/tickets?stationId=${barId}` })
    ).json();
    expect(kitchen).toHaveLength(1);
    expect(bar).toHaveLength(1);
    expect(kitchen[0].status).toBe('PENDING');
    expect(kitchen[0].items[0]).toMatchObject({
      productName: 'Hamburguesa clásica',
      specialInstructions: 'solo una rodaja de tomate',
    });
    expect(kitchen[0].items[0].modifiers[0].name).toBe(doneness.name);
    expect(bar[0].items[0].productName).toBe('Limonada');
    expect([...kitchen, ...bar].flatMap((ticket: any) => ticket.items)).toHaveLength(2);

    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: { commandId: sendCommand, expectedVersion: orderVersion },
    });
    expect(retry.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/kds/tickets?stationId=${kitchenId}` })).json(),
    ).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/printing/jobs' })).json()).toHaveLength(2);
    socket.close();
  });

  it('enforces idempotent forward-only transitions and persists them across restart', async () => {
    const socket = await app.injectWS('/realtime');
    const realtime = new Promise<any>((resolve) =>
      socket.once('message', (payload: Buffer) => resolve(JSON.parse(payload.toString()))),
    );
    const startCommand = '01991a00-3000-7000-8000-000000000005';
    const started = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${roundId}/${kitchenId}/preparing`,
      payload: { commandId: startCommand },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ status: 'PREPARING', preparingAt: expect.any(String) });
    await expect(realtime).resolves.toMatchObject({
      type: 'KDS_TICKETS_CHANGED',
      reason: 'PREPARING',
      stationIds: [kitchenId],
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${roundId}/${kitchenId}/preparing`,
      payload: { commandId: startCommand },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().preparingAt).toBe(started.json().preparingAt);

    const ready = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${roundId}/${kitchenId}/ready`,
      payload: { commandId: '01991a00-3000-7000-8000-000000000006' },
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'READY', readyAt: expect.any(String) });
    const readyRetry = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${roundId}/${kitchenId}/ready`,
      payload: { commandId: '01991a00-3000-7000-8000-000000000006' },
    });
    expect(readyRetry.statusCode).toBe(200);
    expect(readyRetry.json().readyAt).toBe(ready.json().readyAt);
    const regression = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${roundId}/${kitchenId}/preparing`,
      payload: { commandId: '01991a00-3000-7000-8000-000000000007' },
    });
    expect(regression.statusCode).toBe(409);
    expect(regression.json().error).toBe('KDS_INVALID_TRANSITION');
    socket.close();

    await app.close();
    app = await buildApp(dbPath, { startPrintWorker: false });
    await app.ready();
    const persisted = (
      await app.inject({ method: 'GET', url: `/kds/tickets?stationId=${kitchenId}` })
    ).json()[0];
    expect(persisted.status).toBe('READY');
    expect(persisted.preparingAt).toBe(started.json().preparingAt);
    expect(persisted.readyAt).toBe(ready.json().readyAt);
  });

  it('keeps Round and Printing operational without a realtime KDS client', async () => {
    const products = (await app.inject({ method: 'GET', url: '/catalog/products' })).json();
    const lemonade = products.find((product: any) => product.name === 'Limonada');
    const draft = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: '01991a00-3000-7000-8000-000000000008',
        expectedVersion: orderVersion,
        productId: lemonade.id,
      },
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: {
        commandId: '01991a00-3000-7000-8000-000000000009',
        expectedVersion: draft.json().version,
      },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().rounds).toHaveLength(2);
    const barTickets = (
      await app.inject({ method: 'GET', url: `/kds/tickets?stationId=${barId}` })
    ).json();
    expect(barTickets).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/printing/jobs' })).json()).toHaveLength(3);
  });
});
