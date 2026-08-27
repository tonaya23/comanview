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
    for (const migration of [
      '0000_initial.sql',
      '0001_payments_cash.sql',
      '0002_order_item_special_instructions.sql',
      '0003_printing.sql',
      '0004_kds.sql',
    ]) {
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
  let configuredOrderId: string;

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
        commandId: 'c8888888-8888-4888-8888-888888888888',
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
    expect(current.json().session.expectedCash).toEqual({ amount: 2116, currency: 'MXN' });
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
      payload: {
        commandId: 'c8888888-8888-4888-8888-888888888889',
        expectedVersion: persistedDraft.json().version,
      },
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

  it('24. configura modifiers contra catálogo actual y conserva el snapshot histórico', async () => {
    const Database = require('better-sqlite3');
    const sqlite = new Database(tmpPath);
    const configuredProductId = '01991a00-0000-7000-8000-000000000901';
    const configuredTaxId = '01991a00-0000-7000-8000-000000000902';
    const requiredGroupId = '01991a00-0000-7000-8000-000000000903';
    const extrasGroupId = '01991a00-0000-7000-8000-000000000904';
    const mediumId = '01991a00-0000-7000-8000-000000000911';
    const cheeseId = '01991a00-0000-7000-8000-000000000912';
    const threeQuartersId = '01991a00-0000-7000-8000-000000000913';
    const baconId = '01991a00-0000-7000-8000-000000000914';
    sqlite.exec(`
      INSERT INTO tax_profiles
        (id, name, rate_basis_points, calculation_mode, active, is_default)
      VALUES ('${configuredTaxId}', 'IVA configured', 1600, 'TAX_INCLUDED', 1, 0);
      INSERT INTO products
        (id, name, description, product_type, tax_profile_id, base_price_amount,
         base_price_currency, display_order, active, available)
      VALUES ('${configuredProductId}', 'API Burger', '', 'STANDARD', '${configuredTaxId}',
              12900, 'MXN', 1, 1, 1);
      INSERT INTO modifier_groups (id, name, min_selections, max_selections, active)
      VALUES ('${requiredGroupId}', 'Término', 1, 1, 1),
             ('${extrasGroupId}', 'Extras', 0, 2, 1);
      INSERT INTO modifier_options
        (id, group_id, name, price_delta_amount, price_delta_currency, active, available, display_order)
      VALUES ('${mediumId}', '${requiredGroupId}', 'Medio', 0, 'MXN', 1, 1, 1),
             ('${threeQuartersId}', '${requiredGroupId}', '3/4', 0, 'MXN', 1, 1, 2),
             ('${cheeseId}', '${extrasGroupId}', 'Queso', 1500, 'MXN', 1, 1, 1),
             ('${baconId}', '${extrasGroupId}', 'Tocino', 2500, 'MXN', 1, 1, 2);
      INSERT INTO product_modifier_groups (product_id, modifier_group_id, display_order)
      VALUES ('${configuredProductId}', '${extrasGroupId}', 20),
             ('${configuredProductId}', '${requiredGroupId}', 10);
      INSERT INTO modifier_price_overrides
        (product_id, modifier_option_id, price_delta_amount, price_delta_currency)
      VALUES ('${configuredProductId}', '${cheeseId}', 2000, 'MXN');
    `);
    sqlite.close();

    const catalog = await app.inject({ method: 'GET', url: '/catalog/products' });
    const configured = catalog.json().find((product: any) => product.id === configuredProductId);
    expect(configured.modifierGroups.map((group: any) => group.modifierGroup.name)).toEqual([
      'Término',
      'Extras',
    ]);
    expect(configured.modifierGroups[1].priceDeltaOverrides[cheeseId]).toEqual({
      amount: 2000,
      currency: 'MXN',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    configuredOrderId = created.json().id;
    const addPayload = {
      commandId: 'configured-add-idempotent',
      expectedVersion: created.json().version,
      productId: configuredProductId,
      selectedModifierIds: [mediumId, cheeseId],
      specialInstructions: '  salsa aparte  ',
    };
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/items`,
      payload: addPayload,
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().subtotal).toEqual({ amount: 14900, currency: 'MXN' });
    expect(added.json().items[0].specialInstructions).toBe('salsa aparte');
    expect(added.json().items[0].productSnapshot.selectedModifiers).toEqual([
      { modifierOptionId: mediumId, name: 'Medio', priceDelta: { amount: 0, currency: 'MXN' } },
      {
        modifierOptionId: cheeseId,
        name: 'Queso',
        priceDelta: { amount: 2000, currency: 'MXN' },
      },
    ]);

    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/items`,
      payload: { ...addPayload, expectedVersion: added.json().version },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().items).toHaveLength(1);
    expect(retry.json().version).toBe(added.json().version);

    const itemId = added.json().items[0].id;
    const editPayload = {
      commandId: 'configured-note-edit-idempotent',
      expectedVersion: added.json().version,
      specialInstructions: 'solo 1 rodaja de tomate',
    };
    const edited = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: editPayload,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().items[0].specialInstructions).toBe('solo 1 rodaja de tomate');
    expect(edited.json().subtotal).toEqual({ amount: 14900, currency: 'MXN' });

    const editRetry = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: editPayload,
    });
    expect(editRetry.statusCode).toBe(200);
    expect(editRetry.json().version).toBe(edited.json().version);
    const editConflict = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: { ...editPayload, specialInstructions: 'different intent' },
    });
    expect(editConflict.statusCode).toBe(409);
    expect(editConflict.json().error).toBe('COMMAND_ID_CONFLICT');
    const eventSqlite = new Database(tmpPath);
    const eventCount = eventSqlite
      .prepare('SELECT COUNT(*) AS count FROM event_log WHERE command_id = ?')
      .get(editPayload.commandId).count;
    eventSqlite.close();
    expect(eventCount).toBe(1);

    const deletedNote = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: {
        commandId: 'configured-note-delete',
        expectedVersion: edited.json().version,
        specialInstructions: '   ',
      },
    });
    expect(deletedNote.statusCode).toBe(200);
    expect(deletedNote.json().items[0].specialInstructions).toBeNull();

    const restoredNote = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: {
        commandId: 'configured-note-restore',
        expectedVersion: deletedNote.json().version,
        specialInstructions: 'solo 1 rodaja de tomate',
      },
    });
    expect(restoredNote.statusCode).toBe(200);

    const tooLong = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: {
        commandId: 'configured-note-too-long',
        expectedVersion: restoredNote.json().version,
        specialInstructions: 'x'.repeat(501),
      },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error).toBe('SPECIAL_INSTRUCTIONS_TOO_LONG');

    const staleEdit = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: {
        commandId: 'configured-note-stale',
        expectedVersion: added.json().version,
        specialInstructions: null,
      },
    });
    expect(staleEdit.statusCode).toBe(409);
    expect(staleEdit.json().error).toBe('STALE_ORDER_VERSION');

    const partialPayment = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/payments`,
      payload: {
        commandId: 'configured-partial-before-edit',
        expectedVersion: restoredNote.json().version,
        method: 'CARD',
        amountApplied: 5000,
        tip: { type: 'NONE' },
      },
    });
    expect(partialPayment.statusCode).toBe(200);
    expect(partialPayment.json().balanceDue.amount).toBe(9900);

    const missingRequiredEdit = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: {
        commandId: 'configured-draft-edit-missing-required',
        expectedVersion: partialPayment.json().version,
        selectedModifierIds: [],
        specialInstructions: null,
      },
    });
    expect(missingRequiredEdit.statusCode).toBe(409);
    expect(missingRequiredEdit.json().error).toBe('INVALID_MODIFIER_SELECTION');

    const configurationPayload = {
      commandId: 'configured-draft-edit-idempotent',
      expectedVersion: partialPayment.json().version,
      selectedModifierIds: [threeQuartersId, baconId],
      specialInstructions: '  nueva nota integral  ',
    };
    const configurationEdited = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: configurationPayload,
    });
    expect(configurationEdited.statusCode).toBe(200);
    expect(configurationEdited.json().items[0].id).toBe(itemId);
    expect(configurationEdited.json().items[0].productSnapshot.selectedModifiers).toEqual([
      {
        modifierOptionId: threeQuartersId,
        name: '3/4',
        priceDelta: { amount: 0, currency: 'MXN' },
      },
      {
        modifierOptionId: baconId,
        name: 'Tocino',
        priceDelta: { amount: 2500, currency: 'MXN' },
      },
    ]);
    expect(configurationEdited.json().items[0].specialInstructions).toBe('nueva nota integral');
    expect(configurationEdited.json().subtotal.amount).toBe(15400);
    expect(configurationEdited.json().paidAmount.amount).toBe(5000);
    expect(configurationEdited.json().balanceDue.amount).toBe(10400);

    const configurationRetry = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: configurationPayload,
    });
    expect(configurationRetry.statusCode).toBe(200);
    expect(configurationRetry.json().version).toBe(configurationEdited.json().version);
    const configurationConflict = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: { ...configurationPayload, selectedModifierIds: [mediumId] },
    });
    expect(configurationConflict.statusCode).toBe(409);
    expect(configurationConflict.json().error).toBe('COMMAND_ID_CONFLICT');
    const configurationEventSqlite = new Database(tmpPath);
    const configurationEventCount = configurationEventSqlite
      .prepare('SELECT COUNT(*) AS count FROM event_log WHERE command_id = ?')
      .get(configurationPayload.commandId).count;
    configurationEventSqlite.close();
    expect(configurationEventCount).toBe(1);

    const staleConfiguration = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: {
        commandId: 'configured-draft-edit-stale',
        expectedVersion: partialPayment.json().version,
        selectedModifierIds: [mediumId],
        specialInstructions: null,
      },
    });
    expect(staleConfiguration.statusCode).toBe(409);
    expect(staleConfiguration.json().error).toBe('STALE_ORDER_VERSION');

    const configurationRestored = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: {
        commandId: 'configured-draft-edit-restore',
        expectedVersion: configurationEdited.json().version,
        selectedModifierIds: [mediumId, cheeseId],
        specialInstructions: 'solo 1 rodaja de tomate',
      },
    });
    expect(configurationRestored.statusCode).toBe(200);
    expect(configurationRestored.json().subtotal.amount).toBe(14900);
    expect(configurationRestored.json().balanceDue.amount).toBe(9900);

    const changedSqlite = new Database(tmpPath);
    changedSqlite
      .prepare(
        'UPDATE modifier_options SET name = ?, price_delta_amount = ?, available = 0 WHERE id = ?',
      )
      .run('Queso nuevo', 3000, cheeseId);
    changedSqlite
      .prepare('UPDATE products SET name = ?, base_price_amount = ? WHERE id = ?')
      .run('API Burger nueva', 13900, configuredProductId);
    changedSqlite
      .prepare('UPDATE tax_profiles SET rate_basis_points = ? WHERE id = ?')
      .run(800, configuredTaxId);
    changedSqlite.close();

    const persisted = await app.inject({
      method: 'GET',
      url: `/orders/${created.json().id}`,
    });
    expect(persisted.json().items[0].productSnapshot.productName).toBe('API Burger');
    expect(persisted.json().items[0].productSnapshot.basePrice.amount).toBe(12900);
    expect(persisted.json().items[0].productSnapshot.taxRateBasisPoints).toBe(1600);
    expect(persisted.json().items[0].productSnapshot.selectedModifiers[1]).toMatchObject({
      name: 'Queso',
      priceDelta: { amount: 2000, currency: 'MXN' },
    });
    expect(persisted.json().items[0].specialInstructions).toBe('solo 1 rodaja de tomate');

    const unavailableEdit = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: {
        commandId: 'configured-draft-edit-unavailable',
        expectedVersion: persisted.json().version,
        selectedModifierIds: [mediumId, cheeseId],
        specialInstructions: 'must not persist',
      },
    });
    expect(unavailableEdit.statusCode).toBe(409);
    expect(unavailableEdit.json().error).toBe('MODIFIER_UNAVAILABLE');

    const staleOrder = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const staleAdd = await app.inject({
      method: 'POST',
      url: `/orders/${staleOrder.json().id}/items`,
      payload: {
        commandId: 'configured-stale-option',
        expectedVersion: staleOrder.json().version,
        productId: configuredProductId,
        selectedModifierIds: [mediumId, cheeseId],
      },
    });
    expect(staleAdd.statusCode).toBe(409);
    expect(staleAdd.json().error).toBe('MODIFIER_UNAVAILABLE');

    const currentOrder = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { orderType: 'COUNTER', channel: 'POS', currency: 'MXN' },
    });
    const currentAdd = await app.inject({
      method: 'POST',
      url: `/orders/${currentOrder.json().id}/items`,
      payload: {
        commandId: 'configured-current-catalog',
        expectedVersion: currentOrder.json().version,
        productId: configuredProductId,
        selectedModifierIds: [mediumId],
      },
    });
    expect(currentAdd.statusCode).toBe(200);
    expect(currentAdd.json().items[0].productSnapshot).toMatchObject({
      productName: 'API Burger nueva',
      basePrice: { amount: 13900, currency: 'MXN' },
      taxRateBasisPoints: 800,
      selectedModifiers: [{ name: 'Medio', priceDelta: { amount: 0, currency: 'MXN' } }],
    });
    const removedCurrent = await app.inject({
      method: 'DELETE',
      url: `/orders/${currentOrder.json().id}/items/${currentAdd.json().items[0].id}`,
      payload: { expectedVersion: currentAdd.json().version },
    });
    expect(removedCurrent.statusCode).toBe(200);
    expect(removedCurrent.json().items).toHaveLength(0);
    expect(removedCurrent.json().subtotal.amount).toBe(0);

    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/rounds`,
      payload: {
        commandId: 'c8888888-8888-4888-8888-888888888890',
        expectedVersion: persisted.json().version,
      },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().items[0].status).toBe('SENT');
    expect(sent.json().items[0].specialInstructions).toBe('solo 1 rodaja de tomate');
    const sentConfigurationEdit = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/configuration`,
      payload: {
        commandId: 'configured-draft-edit-after-send',
        expectedVersion: sent.json().version,
        selectedModifierIds: [mediumId],
        specialInstructions: null,
      },
    });
    expect(sentConfigurationEdit.statusCode).toBe(409);
    expect(sentConfigurationEdit.json().error).toBe('ORDER_ITEM_SENT');
    const sentEdit = await app.inject({
      method: 'PATCH',
      url: `/orders/${created.json().id}/items/${itemId}/instructions`,
      payload: {
        commandId: 'configured-note-after-send',
        expectedVersion: sent.json().version,
        specialInstructions: 'must fail',
      },
    });
    expect(sentEdit.statusCode).toBe(409);
    expect(sentEdit.json().error).toBe('ORDER_ITEM_SPECIAL_INSTRUCTIONS_FROZEN');
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/payments`,
      payload: {
        commandId: 'configured-payment',
        expectedVersion: sent.json().version,
        method: 'CARD',
        amountApplied: 9900,
        tip: { type: 'NONE' },
      },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().balanceDue.amount).toBe(0);
    const closed = await app.inject({
      method: 'POST',
      url: `/orders/${created.json().id}/close`,
      payload: {
        commandId: 'configured-close',
        expectedVersion: paid.json().version,
      },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('CLOSED');
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

    const configuredResponse = await newApp.inject({
      method: 'GET',
      url: `/orders/${configuredOrderId}`,
    });
    expect(configuredResponse.statusCode).toBe(200);
    expect(configuredResponse.json().status).toBe('CLOSED');
    expect(configuredResponse.json().items[0].productSnapshot).toMatchObject({
      productName: 'API Burger',
      basePrice: { amount: 12900, currency: 'MXN' },
      selectedModifiers: [
        { name: 'Medio', priceDelta: { amount: 0, currency: 'MXN' } },
        { name: 'Queso', priceDelta: { amount: 2000, currency: 'MXN' } },
      ],
    });
    expect(configuredResponse.json().items[0].specialInstructions).toBe('solo 1 rodaja de tomate');

    await newApp.close();
  });
});
