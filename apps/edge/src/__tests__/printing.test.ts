import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { TcpPrinterAdapter, VirtualTcpPrinter } from '@comanview/printing';
import { buildApp } from '../index.js';

describe('Printing vertical slice', () => {
  let app: FastifyInstance;
  const dbPath = join(tmpdir(), `comanview-printing-api-${Date.now()}.db`);
  let orderId = '';
  let version = 0;

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    app = await buildApp(dbPath, { startPrintWorker: false, authMode: 'test-bypass' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`])
      if (existsSync(path)) unlinkSync(path);
  });

  it('routes one Round to two stations, freezes payload, and deduplicates command retry', async () => {
    const products = (await app.inject({ method: 'GET', url: '/catalog/products' })).json();
    const burger = products.find((product: any) => product.name === 'Hamburguesa clásica');
    const lemonade = products.find((product: any) => product.name === 'Limonada');
    const water = products.find((product: any) => product.name === 'Agua mineral');
    const doneness = burger.modifierGroups.find(
      (group: any) => group.modifierGroup.name === 'Término',
    ).modifierGroup.options[0];

    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    orderId = created.json().id;
    version = created.json().version;
    const withBurger = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000001',
        expectedVersion: version,
        productId: burger.id,
        selectedModifierIds: [doneness.id],
        specialInstructions: 'salsa aparte',
      },
    });
    version = withBurger.json().version;
    const withDrink = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000002',
        expectedVersion: version,
        productId: lemonade.id,
      },
    });
    version = withDrink.json().version;
    const withWater = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000009',
        expectedVersion: version,
        productId: water.id,
      },
    });
    version = withWater.json().version;

    const commandId = '01991a00-1000-7000-8000-000000000003';
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: { commandId, expectedVersion: version },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().rounds).toHaveLength(1);
    version = sent.json().version;

    const jobs = (await app.inject({ method: 'GET', url: '/printing/jobs' })).json();
    expect(jobs.filter((job: any) => job.jobType === 'STATION_TICKET')).toHaveLength(2);
    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: { commandId, expectedVersion: version },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().rounds).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/printing/jobs' })).json()).toHaveLength(2);

    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath, { readonly: true });
    const payloads = sqlite
      .prepare("SELECT payload FROM print_jobs WHERE job_type = 'STATION_TICKET'")
      .all()
      .map((row: any) => JSON.parse(row.payload));
    sqlite.close();
    const kitchen = payloads.find((payload: any) => payload.stationName === 'COCINA');
    expect(kitchen.items[0].productName).toBe('Hamburguesa clásica');
    expect(kitchen.items[0].modifiers[0].name).toBe(doneness.name);
    expect(kitchen.items[0].specialInstructions).toBe('salsa aparte');
    expect(
      payloads.find((payload: any) => payload.stationName === 'BARRA').items[0].productName,
    ).toBe('Limonada');
    await app.inject({
      method: 'PATCH',
      url: `/catalog/products/${burger.id}/availability`,
      payload: { available: false },
    });
    const historicalRow = new Database(dbPath, { readonly: true });
    const historicalPayload = JSON.parse(
      (
        historicalRow
          .prepare(
            "SELECT payload FROM print_jobs WHERE job_type = 'STATION_TICKET' AND station_id = ? LIMIT 1",
          )
          .get(burger.stationId) as { payload: string }
      ).payload,
    );
    historicalRow.close();
    expect(historicalPayload.items[0].productName).toBe('Hamburguesa clásica');

    const secondDraft = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000010',
        expectedVersion: version,
        productId: lemonade.id,
      },
    });
    const secondRound = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000011',
        expectedVersion: secondDraft.json().version,
      },
    });
    expect(secondRound.json().rounds).toHaveLength(2);
    version = secondRound.json().version;
    const allStationJobs = (await app.inject({ method: 'GET', url: '/printing/jobs' }))
      .json()
      .filter((job: any) => job.jobType === 'STATION_TICKET');
    expect(allStationJobs).toHaveLength(3);
  });

  it('creates PRECHECK without closing or paying the Order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/precheck`,
      payload: { commandId: '01991a00-1000-7000-8000-000000000004' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().jobType).toBe('PRECHECK');
    const order = (await app.inject({ method: 'GET', url: `/orders/${orderId}` })).json();
    expect(order.status).toBe('OPEN');
    expect(order.payments).toHaveLength(0);
    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath, { readonly: true });
    const payload = JSON.parse(
      (
        sqlite.prepare("SELECT payload FROM print_jobs WHERE job_type = 'PRECHECK'").get() as {
          payload: string;
        }
      ).payload,
    );
    sqlite.close();
    expect(payload.balanceDue.amount).toBe(order.balanceDue.amount);
    const prematureReceipt = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/receipt`,
      payload: { commandId: '01991a00-1000-7000-8000-000000000012' },
    });
    expect(prematureReceipt.statusCode).toBe(409);
    expect(prematureReceipt.json().error).toBe('RECEIPT_REQUIRES_CLOSED_ORDER');
  });

  it('creates a CUSTOMER_RECEIPT only after closing and preserves payment cash detail', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/cash-sessions',
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000005',
        openingFloatAmount: 0,
        businessDate: '2026-08-26',
      },
    });
    expect(opened.statusCode).toBe(201);
    const current = (await app.inject({ method: 'GET', url: `/orders/${orderId}` })).json();
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000006',
        expectedVersion: current.version,
        method: 'CASH',
        amountApplied: current.balanceDue.amount,
        tip: { type: 'FIXED_AMOUNT', amount: 500 },
        cashTendered: current.balanceDue.amount + 1000,
      },
    });
    expect(paid.statusCode).toBe(200);
    const closed = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/close`,
      payload: {
        commandId: '01991a00-1000-7000-8000-000000000007',
        expectedVersion: paid.json().version,
      },
    });
    expect(closed.statusCode).toBe(200);
    const receipt = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/receipt`,
      payload: { commandId: '01991a00-1000-7000-8000-000000000008' },
    });
    expect(receipt.statusCode).toBe(201);
    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath, { readonly: true });
    const row = sqlite
      .prepare("SELECT payload FROM print_jobs WHERE job_type = 'CUSTOMER_RECEIPT'")
      .get() as { payload: string };
    sqlite.close();
    const payload = JSON.parse(row.payload);
    expect(payload.payments[0].tipAmount.amount).toBe(500);
    expect(payload.payments[0].cashTendered.amount).toBe(current.balanceDue.amount + 1000);
    expect(payload.payments[0].changeGiven.amount).toBe(500);
  });
});

describe('TCP virtual printer pipeline', () => {
  it('routes one real Round to independent COCINA and BARRA TCP receivers', async () => {
    const kitchen = new VirtualTcpPrinter();
    const bar = new VirtualTcpPrinter();
    await Promise.all([kitchen.start(), bar.start()]);
    const tcpDbPath = join(tmpdir(), `comanview-printing-tcp-${Date.now()}.db`);
    let tcpApp: FastifyInstance | undefined;
    try {
      prepareDevelopmentDatabase(tcpDbPath);
      const Database = require('better-sqlite3');
      const sqlite = new Database(tcpDbPath);
      sqlite
        .prepare(
          `UPDATE print_targets SET adapter_type = 'TCP_ESC_POS', configuration_json = ? WHERE name = 'Cocina debug'`,
        )
        .run(JSON.stringify({ host: '127.0.0.1', port: kitchen.port }));
      sqlite
        .prepare(
          `UPDATE print_targets SET adapter_type = 'TCP_ESC_POS', configuration_json = ? WHERE name = 'Barra debug'`,
        )
        .run(JSON.stringify({ host: '127.0.0.1', port: bar.port }));
      sqlite.close();

      tcpApp = await buildApp(tcpDbPath, {
        printerAdapter: new TcpPrinterAdapter(),
        authMode: 'test-bypass',
      });
      await tcpApp.ready();
      const products = (await tcpApp.inject({ method: 'GET', url: '/catalog/products' })).json();
      const burger = products.find((product: any) => product.name === 'Hamburguesa clásica');
      const lemonade = products.find((product: any) => product.name === 'Limonada');
      const doneness = burger.modifierGroups.find(
        (group: any) => group.modifierGroup.name === 'Término',
      ).modifierGroup.options[0];
      const created = await tcpApp.inject({
        method: 'POST',
        url: '/orders',
        payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
      });
      const tcpOrderId = created.json().id;
      const withBurger = await tcpApp.inject({
        method: 'POST',
        url: `/orders/${tcpOrderId}/items`,
        payload: {
          commandId: '01991a00-2000-7000-8000-000000000001',
          expectedVersion: created.json().version,
          productId: burger.id,
          selectedModifierIds: [doneness.id],
          specialInstructions: 'salsa aparte',
        },
      });
      const withLemonade = await tcpApp.inject({
        method: 'POST',
        url: `/orders/${tcpOrderId}/items`,
        payload: {
          commandId: '01991a00-2000-7000-8000-000000000002',
          expectedVersion: withBurger.json().version,
          productId: lemonade.id,
        },
      });
      const commandId = '01991a00-2000-7000-8000-000000000003';
      const sent = await tcpApp.inject({
        method: 'POST',
        url: `/orders/${tcpOrderId}/rounds`,
        payload: { commandId, expectedVersion: withLemonade.json().version },
      });
      expect(sent.statusCode).toBe(200);
      const [kitchenBytes, barBytes] = await Promise.all([
        kitchen.waitForPayload(),
        bar.waitForPayload(),
      ]);
      const kitchenTicket = new TextDecoder().decode(kitchenBytes);
      const barTicket = new TextDecoder().decode(barBytes);
      expect(kitchenTicket).toContain('Hamburguesa clásica');
      expect(kitchenTicket).toContain(doneness.name);
      expect(kitchenTicket).toContain('NOTE: salsa aparte');
      expect(barTicket).toContain('Limonada');
      expect(barTicket).not.toContain('Hamburguesa clásica');

      const retry = await tcpApp.inject({
        method: 'POST',
        url: `/orders/${tcpOrderId}/rounds`,
        payload: { commandId, expectedVersion: sent.json().version },
      });
      expect(retry.statusCode).toBe(200);
      const jobs = (await tcpApp.inject({ method: 'GET', url: '/printing/jobs' })).json();
      expect(jobs).toHaveLength(2);
      expect(jobs.every((job: any) => job.status === 'DELIVERED')).toBe(true);
    } finally {
      if (tcpApp) await tcpApp.close();
      await Promise.all([kitchen.stop(), bar.stop()]);
      for (const path of [tcpDbPath, `${tcpDbPath}-shm`, `${tcpDbPath}-wal`])
        if (existsSync(path)) unlinkSync(path);
    }
  });
});
