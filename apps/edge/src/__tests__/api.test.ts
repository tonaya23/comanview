import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index.js';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';

describe('Edge API Integration Tests', () => {
  let app: FastifyInstance;
  let tmpPath: string;

  beforeAll(async () => {
    tmpPath = path.join(os.tmpdir(), `comanview-api-test-${Date.now()}.db`);

    // Create DB with migration
    const Database = require('better-sqlite3');
    const sqlite = new Database(tmpPath);
    for (const migration of ['0000_initial.sql', '0001_payments_cash.sql']) {
      sqlite.exec(
        readFileSync(path.resolve(__dirname, `../../../../migrations/edge/${migration}`), 'utf-8'),
      );
    }
    sqlite.close();

    app = await buildApp(tmpPath);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    try {
      require('fs').unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    try {
      require('fs').unlinkSync(tmpPath + '-shm');
    } catch {
      /* ignore */
    }
    try {
      require('fs').unlinkSync(tmpPath + '-wal');
    } catch {
      /* ignore */
    }
  });

  it('1. GET /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('UP');
    expect(body.edgeService.status).toBe('OK');
    expect(body.database.status).toBe('OK');
  });

  let productId: string;

  it('2. POST /catalog/products', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/catalog/products',
      payload: {
        name: 'Test Burger',
        description: 'Delicious burger',
        productType: 'STANDARD',
        taxProfileId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        basePrice: {
          amount: 1500,
          currency: 'MXN',
        },
      },
    });

    const body = response.json();
    if (response.statusCode !== 201) console.error('TEST 2 FAILED', response.statusCode, body);
    expect(response.statusCode).toBe(201);
    expect(body.name).toBe('Test Burger');
    productId = body.id;
  });

  it('3. GET /catalog/products/:id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/catalog/products/${productId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(productId);
    expect(body.name).toBe('Test Burger');
  });

  it('4. PATCH /catalog/products/:id/availability (mark unavailable)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/catalog/products/${productId}/availability`,
      payload: {
        available: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.available).toBe(false);

    // Restore availability for subsequent tests
    const restoreResp = await app.inject({
      method: 'PATCH',
      url: `/catalog/products/${productId}/availability`,
      payload: { available: true },
    });
    expect(restoreResp.statusCode).toBe(200);
    expect(restoreResp.json().available).toBe(true);
  });

  let orderId: string;
  let orderVersion: number;

  it('5. POST /orders', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        orderType: 'TABLE',
        channel: 'WAITER',
        currency: 'MXN',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.orderType).toBe('TABLE');
    expect(body.status).toBe('OPEN');
    orderId = body.id;
    orderVersion = body.version;
  });

  let itemId: string;

  it('6 & 7. POST /orders/:id/items (creates snapshot)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: 'c1111111-1111-1111-1111-111111111111',
        expectedVersion: orderVersion,
        productId: productId,
      },
    });

    const body = response.json();
    if (response.statusCode !== 200) console.error('TEST 6 FAILED', response.statusCode, body);
    expect(response.statusCode).toBe(200);
    expect(body.items.length).toBe(1);
    expect(body.subtotal).toEqual({ amount: 1500, currency: 'MXN' });
    expect(body.version).toBe(orderVersion + 1);
    orderVersion = body.version;
    itemId = body.items[0].id;

    // 7. Verify snapshot was created from catalog
    expect(body.items[0].productSnapshot.productName).toBe('Test Burger');
    expect(body.items[0].productSnapshot.basePrice.amount).toBe(1500);
  });

  it('17. PUT /orders/:id/tables', async () => {
    const tableId = '018f2c70-7b00-7000-8000-000000000001'; // valid UUID v7
    const response = await app.inject({
      method: 'PUT',
      url: `/orders/${orderId}/tables`,
      payload: {
        expectedVersion: orderVersion,
        tableIds: [tableId],
      },
    });
    if (response.statusCode !== 200)
      console.error('TEST 17 FAILED', response.statusCode, response.json());
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tableIds).toContain(tableId);
    expect(body.version).toBe(orderVersion + 1);
    orderVersion = body.version;
  });

  it('12. Retry idempotente con mismo commandId (no aumenta version)', async () => {
    // Re-send the SAME commandId — should be idempotent
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: 'c1111111-1111-1111-1111-111111111111', // SAME commandId as test 6
        expectedVersion: orderVersion, // Current version (doesn't matter — already processed)
        productId: productId,
      },
    });

    const body = response.json();
    if (response.statusCode !== 200) console.error('TEST 12 FAILED', response.statusCode, body);
    expect(response.statusCode).toBe(200);
    // Items count should still be 1, version should be the same
    expect(body.items.length).toBe(1);
    expect(body.version).toBe(orderVersion);
  });

  it('11. Optimistic concurrency conflict (STALE_ORDER_VERSION)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: 'c2222222-2222-2222-2222-222222222222',
        expectedVersion: orderVersion - 1, // WRONG VERSION
        productId: productId,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('STALE_ORDER_VERSION');
  });

  it('8. POST /orders/:id/rounds (enviar round)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/rounds`,
      payload: {
        expectedVersion: orderVersion,
      },
    });

    const body = response.json();
    if (response.statusCode !== 200) console.error('TEST 8 FAILED', response.statusCode, body);
    expect(response.statusCode).toBe(200);
    expect(body.rounds.length).toBe(1);
    expect(body.items[0].status).toBe('SENT');
    expect(body.version).toBe(orderVersion + 1);
    orderVersion = body.version;
  });

  it('10. Impedir eliminar SENT', async () => {
    // itemId is SENT, should reject deletion
    const response = await app.inject({
      method: 'DELETE',
      url: `/orders/${orderId}/items/${itemId}`,
      payload: {
        expectedVersion: orderVersion,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('ORDER_ITEM_SENT');
  });

  it('9. Eliminar DRAFT', async () => {
    // Add another item (DRAFT)
    const addResp = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/items`,
      payload: {
        commandId: 'c3333333-3333-3333-3333-333333333333',
        expectedVersion: orderVersion,
        productId: productId,
      },
    });

    const addBody = addResp.json();
    if (addResp.statusCode !== 200) console.error('TEST 9 ADD FAILED', addResp.statusCode, addBody);
    expect(addResp.statusCode).toBe(200);
    orderVersion = addBody.version;
    // The first item is SENT, second item is DRAFT (most recently added)
    const draftItem = addBody.items.find((i: any) => i.status === 'DRAFT');
    expect(draftItem).toBeDefined();
    const newItemId = draftItem.id;

    // Remove the draft item
    const response = await app.inject({
      method: 'DELETE',
      url: `/orders/${orderId}/items/${newItemId}`,
      payload: {
        expectedVersion: orderVersion,
      },
    });

    const body = response.json();
    if (response.statusCode !== 200)
      console.error('TEST 9 DELETE FAILED', response.statusCode, body);
    expect(response.statusCode).toBe(200);
    expect(body.items.length).toBe(1); // Back to 1 item (the SENT one)
    expect(body.subtotal).toEqual({ amount: 1500, currency: 'MXN' });
    expect(body.version).toBe(orderVersion + 1);
    orderVersion = body.version;

    const persistedResponse = await app.inject({
      method: 'GET',
      url: `/orders/${orderId}`,
    });
    expect(persistedResponse.statusCode).toBe(200);
    expect(persistedResponse.json().items).toHaveLength(1);
    expect(persistedResponse.json().subtotal).toEqual({ amount: 1500, currency: 'MXN' });
  });

  it('18. Payment sin CashSession OPEN es rechazado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId: 'pay-no-session',
        expectedVersion: orderVersion,
        method: 'CARD',
        amountApplied: 100,
        tip: { type: 'NONE' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('CASH_SESSION_NOT_OPEN');
  });

  it('19. Abre CashSession idempotente e impide una segunda OPEN', async () => {
    const current = await app.inject({ method: 'GET', url: '/cash-sessions/current' });
    expect(current.statusCode).toBe(200);
    expect(current.json().session).toBeNull();

    const payload = {
      commandId: 'open-register-2026-08-25',
      openingFloatAmount: 2000,
      businessDate: '2026-08-25',
    };
    const opened = await app.inject({ method: 'POST', url: '/cash-sessions', payload });
    expect(opened.statusCode).toBe(201);
    expect(opened.json().openingFloat).toEqual({ amount: 2000, currency: 'MXN' });
    expect(opened.json().expectedCash).toEqual({ amount: 2000, currency: 'MXN' });

    const retry = await app.inject({ method: 'POST', url: '/cash-sessions', payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().id).toBe(opened.json().id);

    const second = await app.inject({
      method: 'POST',
      url: '/cash-sessions',
      payload: { ...payload, commandId: 'open-register-second' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('CASH_SESSION_ALREADY_OPEN');
  });

  it('20. CASH parcial calcula tip HALF_UP, tendered y change; retry es idempotente', async () => {
    const commandId = 'payment-cash-partial';
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId,
        expectedVersion: orderVersion,
        method: 'CASH',
        amountApplied: 105,
        tip: { type: 'PERCENTAGE', basisPoints: 1000 },
        cashTendered: 120,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.paidAmount).toEqual({ amount: 105, currency: 'MXN' });
    expect(body.balanceDue).toEqual({ amount: 1395, currency: 'MXN' });
    expect(body.tipTotal).toEqual({ amount: 11, currency: 'MXN' });
    expect(body.payments[0]).toMatchObject({
      method: 'CASH',
      status: 'COMPLETED',
      amountApplied: { amount: 105, currency: 'MXN' },
      tipAmount: { amount: 11, currency: 'MXN' },
      cashTendered: { amount: 120, currency: 'MXN' },
      changeGiven: { amount: 4, currency: 'MXN' },
    });
    orderVersion = body.version;

    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId,
        expectedVersion: orderVersion,
        method: 'CASH',
        amountApplied: 105,
        tip: { type: 'PERCENTAGE', basisPoints: 1000 },
        cashTendered: 120,
      },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().version).toBe(orderVersion);
    expect(retry.json().payments).toHaveLength(1);
  });

  it('21. Impide overpayment y completa un mixed payment CASH + CARD', async () => {
    const overpayment = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId: 'payment-overpayment',
        expectedVersion: orderVersion,
        method: 'CARD',
        amountApplied: 1396,
        tip: { type: 'NONE' },
      },
    });
    expect(overpayment.statusCode).toBe(409);
    expect(overpayment.json().error).toBe('PAYMENT_OVERPAYMENT');

    const card = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId: 'payment-card-final',
        expectedVersion: orderVersion,
        method: 'CARD',
        amountApplied: 1395,
        tip: { type: 'FIXED_AMOUNT', amount: 25 },
        externalReference: 'terminal-approved',
      },
    });
    expect(card.statusCode).toBe(200);
    const body = card.json();
    expect(body.payments).toHaveLength(2);
    expect(body.payments[1]).toMatchObject({
      method: 'CARD',
      status: 'COMPLETED',
      tipAmount: { amount: 25, currency: 'MXN' },
      cashTendered: null,
      changeGiven: { amount: 0, currency: 'MXN' },
    });
    expect(body.paidAmount.amount).toBe(1500);
    expect(body.balanceDue.amount).toBe(0);
    expect(body.tipTotal.amount).toBe(36);
    orderVersion = body.version;

    const voided = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments/${body.payments[1].id}/void`,
      payload: { commandId: 'void-card-administrative', expectedVersion: orderVersion },
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().payments[1].status).toBe('VOIDED');
    expect(voided.json().paidAmount.amount).toBe(105);
    expect(voided.json().balanceDue.amount).toBe(1395);
    orderVersion = voided.json().version;

    const replacementCard = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/payments`,
      payload: {
        commandId: 'payment-card-replacement',
        expectedVersion: orderVersion,
        method: 'CARD',
        amountApplied: 1395,
        tip: { type: 'FIXED_AMOUNT', amount: 25 },
        externalReference: 'terminal-approved-replacement',
      },
    });
    expect(replacementCard.statusCode).toBe(200);
    expect(replacementCard.json().payments).toHaveLength(3);
    expect(replacementCard.json().balanceDue.amount).toBe(0);
    orderVersion = replacementCard.json().version;

    const current = await app.inject({ method: 'GET', url: '/cash-sessions/current' });
    expect(current.json().session.expectedCash).toEqual({ amount: 2105, currency: 'MXN' });
  });

  it('15. Edge impide cierre pendiente y separa PAYMENT_COMPLETED de ORDER_CLOSED', async () => {
    const unpaidOrder = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const unpaidId = unpaidOrder.json().id;
    const add = await app.inject({
      method: 'POST',
      url: `/orders/${unpaidId}/items`,
      payload: {
        commandId: 'unpaid-add',
        expectedVersion: unpaidOrder.json().version,
        productId,
      },
    });
    const rejectedClose = await app.inject({
      method: 'POST',
      url: `/orders/${unpaidId}/close`,
      payload: { commandId: 'unpaid-close', expectedVersion: add.json().version },
    });
    expect(rejectedClose.statusCode).toBe(409);
    expect(rejectedClose.json().error).toBe('ORDER_BALANCE_NOT_ZERO');

    const draftOrder = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const draftAdd = await app.inject({
      method: 'POST',
      url: `/orders/${draftOrder.json().id}/items`,
      payload: {
        commandId: 'draft-close-add',
        expectedVersion: draftOrder.json().version,
        productId,
      },
    });
    const draftPayment = await app.inject({
      method: 'POST',
      url: `/orders/${draftOrder.json().id}/payments`,
      payload: {
        commandId: 'draft-close-payment',
        expectedVersion: draftAdd.json().version,
        method: 'CARD',
        amountApplied: 1500,
        tip: { type: 'NONE' },
      },
    });
    expect(draftPayment.statusCode).toBe(200);
    expect(draftPayment.json().balanceDue.amount).toBe(0);

    const draftClose = await app.inject({
      method: 'POST',
      url: `/orders/${draftOrder.json().id}/close`,
      payload: {
        commandId: 'draft-close-rejected',
        expectedVersion: draftPayment.json().version,
      },
    });
    expect(draftClose.statusCode).toBe(409);
    expect(draftClose.json().error).toBe('ORDER_HAS_DRAFT_ITEMS');

    const persistedDraft = await app.inject({
      method: 'GET',
      url: `/orders/${draftOrder.json().id}`,
    });
    expect(persistedDraft.json().status).toBe('OPEN');
    expect(persistedDraft.json().items[0].status).toBe('DRAFT');
    expect(persistedDraft.json().rounds).toHaveLength(0);

    const sentDraft = await app.inject({
      method: 'POST',
      url: `/orders/${draftOrder.json().id}/rounds`,
      payload: { expectedVersion: persistedDraft.json().version },
    });
    const closeAfterSend = await app.inject({
      method: 'POST',
      url: `/orders/${draftOrder.json().id}/close`,
      payload: {
        commandId: 'draft-close-after-send',
        expectedVersion: sentDraft.json().version,
      },
    });
    expect(closeAfterSend.statusCode).toBe(200);
    expect(closeAfterSend.json().status).toBe('CLOSED');

    const closeResp = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/close`,
      payload: { commandId: 'close-paid-order', expectedVersion: orderVersion },
    });

    if (closeResp.statusCode !== 200)
      console.error('TEST 15 CLOSE FAILED', closeResp.statusCode, closeResp.json());
    expect(closeResp.statusCode).toBe(200);
    expect(closeResp.json().status).toBe('CLOSED');
    orderVersion = closeResp.json().version;

    const closeRetry = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/close`,
      payload: { commandId: 'close-paid-order', expectedVersion: orderVersion },
    });
    expect(closeRetry.statusCode).toBe(200);
    expect(closeRetry.json().version).toBe(orderVersion);

    const conflictingCommand = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/close`,
      payload: { commandId: 'payment-cash-partial', expectedVersion: orderVersion },
    });
    expect(conflictingCommand.statusCode).toBe(409);
    expect(conflictingCommand.json().error).toBe('COMMAND_ID_CONFLICT');

    // Now try to cancel a CLOSED order — should fail with ORDER_ALREADY_CLOSED
    const response = await app.inject({
      method: 'POST',
      url: `/orders/${orderId}/cancel`,
      payload: {
        expectedVersion: orderVersion,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('ORDER_ALREADY_CLOSED');
  });

  it('13 & 16. Order persiste entre requests y reinicializar app', async () => {
    // Close the app entirely
    await app.close();

    // Start a new instance pointing to the same db
    const newApp = await buildApp(tmpPath);
    await newApp.ready();

    const response = await newApp.inject({
      method: 'GET',
      url: `/orders/${orderId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('CLOSED');
    expect(body.version).toBe(orderVersion);

    await newApp.close();
  });
});
