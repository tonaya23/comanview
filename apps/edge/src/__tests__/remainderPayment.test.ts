import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { buildApp } from '../index.js';

describe('CASH remainder tip', () => {
  const dbPath = join(tmpdir(), `comanview-remainder-payment-${Date.now()}.db`);
  let app: FastifyInstance;
  let waterId = '';
  let commandSequence = 0;

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    app = await buildApp(dbPath, { startPrintWorker: false, authMode: 'test-bypass' });
    await app.ready();
    const products = (await app.inject({ method: 'GET', url: '/catalog/products' })).json();
    waterId = products.find((product: any) => product.name === 'Agua mineral').id;
    const opened = await app.inject({
      method: 'POST',
      url: '/cash-sessions',
      payload: {
        commandId: 'remainder-open-cash',
        openingFloatAmount: 1000,
        businessDate: '2026-08-27',
      },
    });
    expect(opened.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  async function createWaterOrder() {
    const sequence = ++commandSequence;
    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/items`,
      payload: {
        commandId: `remainder-add-water-${sequence}`,
        expectedVersion: created.json().version,
        productId: waterId,
      },
    });
    return { orderId: created.json().id as string, version: added.json().version as number };
  }

  it('keeps $8 as a separate tip, gives no change, updates expected cash, and retries idempotently', async () => {
    const order = await createWaterOrder();
    const payload = {
      commandId: 'remainder-payment-40',
      expectedVersion: order.version,
      method: 'CASH',
      amountApplied: 3200,
      tip: { type: 'REMAINDER' },
      cashTendered: 4000,
    } as const;
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${order.orderId}/payments`,
      payload,
    });

    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      paidAmount: { amount: 3200, currency: 'MXN' },
      balanceDue: { amount: 0, currency: 'MXN' },
      tipTotal: { amount: 800, currency: 'MXN' },
      payments: [
        {
          amountApplied: { amount: 3200, currency: 'MXN' },
          tipAmount: { amount: 800, currency: 'MXN' },
          chargedTotal: { amount: 4000, currency: 'MXN' },
          cashTendered: { amount: 4000, currency: 'MXN' },
          changeGiven: { amount: 0, currency: 'MXN' },
        },
      ],
    });
    const currentCash = await app.inject({ method: 'GET', url: '/cash-sessions/current' });
    expect(currentCash.json().session.expectedCash).toBeNull();
    const xReport = await app.inject({
      method: 'POST',
      url: '/cash-sessions/current/x-report',
      payload: { commandId: 'remainder-expected-cash-x' },
    });
    expect(xReport.statusCode).toBe(201);
    expect(xReport.json().expectedCash).toEqual({ amount: 5000, currency: 'MXN' });

    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${order.orderId}/payments`,
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().version).toBe(paid.json().version);
    expect(retry.json().payments).toHaveLength(1);
  });

  it('allows exact CASH with zero remainder tip', async () => {
    const order = await createWaterOrder();
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${order.orderId}/payments`,
      payload: {
        commandId: 'remainder-payment-exact',
        expectedVersion: order.version,
        method: 'CASH',
        amountApplied: 3200,
        tip: { type: 'REMAINDER' },
        cashTendered: 3200,
      },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().payments[0]).toMatchObject({
      tipAmount: { amount: 0, currency: 'MXN' },
      changeGiven: { amount: 0, currency: 'MXN' },
    });
  });

  it('rejects insufficient tendered, CARD, and partial remainder intent', async () => {
    const insufficientOrder = await createWaterOrder();
    const insufficient = await app.inject({
      method: 'POST',
      url: `/orders/${insufficientOrder.orderId}/payments`,
      payload: {
        commandId: 'remainder-payment-insufficient',
        expectedVersion: insufficientOrder.version,
        method: 'CASH',
        amountApplied: 3200,
        tip: { type: 'REMAINDER' },
        cashTendered: 3199,
      },
    });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json().error).toBe('INVALID_CASH_TENDERED');

    const cardOrder = await createWaterOrder();
    const card = await app.inject({
      method: 'POST',
      url: `/orders/${cardOrder.orderId}/payments`,
      payload: {
        commandId: 'remainder-payment-card',
        expectedVersion: cardOrder.version,
        method: 'CARD',
        amountApplied: 3200,
        tip: { type: 'REMAINDER' },
      },
    });
    expect(card.statusCode).toBe(400);
    expect(card.json().error).toBe('INVALID_TIP');

    const partialOrder = await createWaterOrder();
    const partial = await app.inject({
      method: 'POST',
      url: `/orders/${partialOrder.orderId}/payments`,
      payload: {
        commandId: 'remainder-payment-partial',
        expectedVersion: partialOrder.version,
        method: 'CASH',
        amountApplied: 1000,
        tip: { type: 'REMAINDER' },
        cashTendered: 1200,
      },
    });
    expect(partial.statusCode).toBe(400);
    expect(partial.json().error).toBe('INVALID_TIP');
  });
});
