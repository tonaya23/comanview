import { readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashOperationalPinSync, BASE_ROLE_PERMISSIONS } from '@comanview/auth';
import { buildApp } from '../index.js';

const Database = createRequire(import.meta.url)('better-sqlite3') as any;

const tenantId = '01991a00-0000-7000-8000-000000000301';
const locationId = '01991a00-0000-7000-8000-000000000302';
const waiterId = '01991a00-0000-7000-8000-000000000713';
const kitchenId = '01991a00-0000-7000-8000-000000000714';
const ownerId = '01991a00-0000-7000-8000-000000000711';
const waiterDeviceId = '01991a00-0000-7000-8000-000000000723';
const ownerDeviceId = '01991a00-0000-7000-8000-000000000721';
const kitchenDeviceId = '01991a00-0000-7000-8000-000000000724';
const table1 = '01991a00-0000-7000-8000-000000000801';
const table2 = '01991a00-0000-7000-8000-000000000802';
const table3 = '01991a00-0000-7000-8000-000000000803';
const table4 = '01991a00-0000-7000-8000-000000000804';
const table5 = '01991a00-0000-7000-8000-000000000805';
const table6 = '01991a00-0000-7000-8000-000000000806';
const table7 = '01991a00-0000-7000-8000-000000000807';
const productId = '01991a00-0000-7000-8000-000000000101';
const stationId = '01991a00-0000-7000-8000-000000000501';

function migrateAndSeed(path: string) {
  const sqlite = new Database(path);
  for (const migration of [
    '0000_initial.sql',
    '0001_payments_cash.sql',
    '0002_order_item_special_instructions.sql',
    '0003_printing.sql',
    '0004_kds.sql',
    '0005_local_auth.sql',
    '0006_audit_log.sql',
    '0007_cash_operations_closure.sql',
    '0008_tables_waiter.sql',
    '0009_operational_realtime.sql',
    '0010_sync_foundation.sql',
    '0011_edge_provisioning.sql',
  ]) {
    sqlite.exec(
      readFileSync(resolve(__dirname, `../../../../migrations/edge/${migration}`), 'utf8'),
    );
  }
  sqlite.exec(`
    INSERT INTO categories VALUES ('01991a00-0000-7000-8000-000000000001', 'Food', 1);
    INSERT INTO tax_profiles VALUES ('01991a00-0000-7000-8000-000000000010', 'Tax', 0, 'TAX_INCLUDED', 1, 1);
    INSERT INTO stations VALUES ('${stationId}', '${tenantId}', '${locationId}', 'COCINA', 1);
    INSERT INTO products
      (id, name, description, product_type, category_id, tax_profile_id, base_price_amount,
       base_price_currency, display_order, active, available, station_id)
    VALUES ('${productId}', 'Test product', '', 'STANDARD',
      '01991a00-0000-7000-8000-000000000001',
      '01991a00-0000-7000-8000-000000000010', 1000, 'MXN', 1, 1, 1, '${stationId}');
    INSERT INTO print_targets VALUES
      ('01991a00-0000-7000-8000-000000000511', '${tenantId}', '${locationId}', '${stationId}',
       'Kitchen debug', 'DEBUG', '{}', 1);
    INSERT INTO restaurant_tables VALUES
      ('${table1}', '${tenantId}', '${locationId}', 'Mesa 1', 'SALÓN', 4, 10, 1),
      ('${table2}', '${tenantId}', '${locationId}', 'Mesa 2', 'SALÓN', 4, 20, 1),
      ('${table3}', '${tenantId}', '${locationId}', 'Mesa 3', 'SALÓN', 4, 30, 1),
      ('${table4}', '${tenantId}', '${locationId}', 'Mesa 4', 'TERRAZA', 4, 40, 1),
      ('${table5}', '${tenantId}', '${locationId}', 'Mesa 5', 'TERRAZA', 4, 50, 1),
      ('${table6}', '${tenantId}', '${locationId}', 'Mesa 6', 'TERRAZA', 4, 60, 1),
      ('${table7}', '${tenantId}', '${locationId}', 'Mesa 7', 'TERRAZA', 4, 70, 1);
  `);

  const insertRole = sqlite.prepare('INSERT INTO roles (id, name) VALUES (?, ?)');
  const insertPermission = sqlite.prepare('INSERT OR IGNORE INTO permissions VALUES (?, ?)');
  const assignPermission = sqlite.prepare('INSERT INTO role_permissions VALUES (?, ?)');
  const roles = [
    ['01991a00-0000-7000-8000-000000000701', 'OWNER', BASE_ROLE_PERMISSIONS.OWNER],
    ['01991a00-0000-7000-8000-000000000704', 'WAITER', BASE_ROLE_PERMISSIONS.WAITER],
    ['01991a00-0000-7000-8000-000000000705', 'KITCHEN', BASE_ROLE_PERMISSIONS.KITCHEN],
  ] as const;
  for (const [roleId, role, permissions] of roles) {
    insertRole.run(roleId, role);
    for (const permission of permissions) {
      insertPermission.run(permission, permission);
      assignPermission.run(roleId, permission);
    }
  }
  const insertUser = sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertUser.run(
    waiterId,
    tenantId,
    locationId,
    'Waiter test',
    'ACTIVE',
    hashOperationalPinSync('3333'),
    Date.now(),
  );
  insertUser.run(
    kitchenId,
    tenantId,
    locationId,
    'Kitchen test',
    'ACTIVE',
    hashOperationalPinSync('4444'),
    Date.now(),
  );
  insertUser.run(
    ownerId,
    tenantId,
    locationId,
    'Owner test',
    'ACTIVE',
    hashOperationalPinSync('1111'),
    Date.now(),
  );
  sqlite.prepare('INSERT INTO user_roles VALUES (?, ?)').run(ownerId, roles[0][0]);
  sqlite.prepare('INSERT INTO user_roles VALUES (?, ?)').run(waiterId, roles[1][0]);
  sqlite.prepare('INSERT INTO user_roles VALUES (?, ?)').run(kitchenId, roles[2][0]);
  sqlite
    .prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(waiterDeviceId, tenantId, locationId, 'Waiter test', 'WAITER', 'ACTIVE', 720, Date.now());
  sqlite
    .prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ownerDeviceId, tenantId, locationId, 'POS test', 'POS', 'ACTIVE', 720, Date.now());
  sqlite
    .prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(kitchenDeviceId, tenantId, locationId, 'Kitchen test', 'KDS', 'ACTIVE', 720, Date.now());
  sqlite.close();
}

describe('Tables + Waiter vertical slice', () => {
  let app: FastifyInstance;
  let databasePath: string;
  let waiterToken: string;
  let ownerToken: string;
  let kitchenToken: string;

  beforeAll(async () => {
    databasePath = join(tmpdir(), `comanview-tables-${Date.now()}.db`);
    migrateAndSeed(databasePath);
    app = await buildApp(databasePath, { startPrintWorker: false });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { pin: '3333', deviceId: waiterDeviceId },
    });
    waiterToken = login.json().token;
    ownerToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { pin: '1111', deviceId: ownerDeviceId },
      })
    ).json().token;
    kitchenToken = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { pin: '4444', deviceId: kitchenDeviceId },
      })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        unlinkSync(databasePath + suffix);
      } catch {
        /* already absent */
      }
    }
  });

  const auth = () => ({ authorization: `Bearer ${waiterToken}` });
  const createTableOrder = (tableIds: string[], commandId = crypto.randomUUID()) =>
    app.inject({
      method: 'POST',
      url: '/orders',
      headers: auth(),
      payload: { commandId, orderType: 'TABLE', channel: 'WAITER', currency: 'MXN', tableIds },
    });

  async function openRealtime(token: string) {
    const socket = await app.injectWS('/realtime');
    const authenticated = new Promise<void>((resolvePromise) => {
      const onMessage = (payload: Buffer) => {
        if (JSON.parse(payload.toString()).type !== 'AUTHENTICATED') return;
        socket.off('message', onMessage);
        resolvePromise();
      };
      socket.on('message', onMessage);
    });
    socket.send(JSON.stringify({ type: 'AUTHENTICATE', token }));
    await authenticated;
    return socket;
  }

  function waitForMessage(socket: any, predicate: (message: any) => boolean) {
    return new Promise<any>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error('Timed out waiting for realtime message.'));
      }, 2_000);
      const onMessage = (payload: Buffer) => {
        const message = JSON.parse(payload.toString());
        if (!predicate(message)) return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolvePromise(message);
      };
      socket.on('message', onMessage);
    });
  }

  it('creates a TABLE Order, supports multiple tables, moves without recreating it, and releases on close', async () => {
    const created = await createTableOrder([table1]);
    expect(created.statusCode).toBe(201);
    let order = created.json();

    const joined = await app.inject({
      method: 'PUT',
      url: `/orders/${order.id}/tables`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        tableIds: [table1, table2],
      },
    });
    expect(joined.statusCode).toBe(200);
    order = joined.json();
    expect(order.tableIds).toEqual([table1, table2]);

    const moved = await app.inject({
      method: 'PUT',
      url: `/orders/${order.id}/tables`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        tableIds: [table3],
      },
    });
    order = moved.json();
    expect(order.id).toBe(created.json().id);
    const afterMove = (await app.inject({ method: 'GET', url: '/tables', headers: auth() })).json();
    expect(afterMove.find((table: any) => table.id === table1).status).toBe('FREE');
    expect(afterMove.find((table: any) => table.id === table3).activeOrderId).toBe(order.id);

    const closed = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/close`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { commandId: crypto.randomUUID(), expectedVersion: order.version },
    });
    expect(closed.statusCode).toBe(200);
    const afterClose = (
      await app.inject({ method: 'GET', url: '/tables', headers: auth() })
    ).json();
    expect(afterClose.find((table: any) => table.id === table3).status).toBe('FREE');
  });

  it('allows exactly one winner when two clients open the same table', async () => {
    const [left, right] = await Promise.all([
      createTableOrder([table1]),
      createTableOrder([table1]),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([201, 409]);
    expect([left.json().error, right.json().error]).toContain('TABLE_OCCUPIED');
  });

  it('rejects an occupied move and preserves the original assignments', async () => {
    const source = (await createTableOrder([table2])).json();
    const occupied = await app.inject({
      method: 'PUT',
      url: `/orders/${source.id}/tables`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: source.version,
        tableIds: [table1],
      },
    });
    expect(occupied.statusCode).toBe(409);
    expect(occupied.json().error).toBe('TABLE_OCCUPIED');
    expect(
      (await app.inject({ method: 'GET', url: `/orders/${source.id}`, headers: auth() })).json()
        .tableIds,
    ).toEqual([table2]);
  });

  it('uses the normal Round pipeline so Waiter sends reach KDS and durable Printing', async () => {
    const created = (await createTableOrder([table3])).json();
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/items`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: created.version,
        productId,
        specialInstructions: 'Sin sal',
      },
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/rounds`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: added.json().version },
    });
    expect(sent.statusCode).toBe(200);
    const tickets = await app.inject({
      method: 'GET',
      url: `/kds/tickets?stationId=${stationId}`,
      headers: { authorization: `Bearer ${kitchenToken}` },
    });
    expect(tickets.statusCode).toBe(200);
    expect(tickets.json()[0].items[0].specialInstructions).toBe('Sin sal');
    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE order_id = ?').get(created.id),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ? AND send_status = ?')
        .get(created.id, 'SENT'),
    ).toEqual({ count: 1 });
    sqlite.close();
  });

  it('lets WAITER cancel only an untouched TABLE Order, releases every table and audits once', async () => {
    const created = (await createTableOrder([table4, table5])).json();
    const forbiddenGeneralCancel = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel`,
      headers: auth(),
      payload: { expectedVersion: created.version },
    });
    expect(forbiddenGeneralCancel.statusCode).toBe(403);

    const commandId = crypto.randomUUID();
    const cancelled = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId, expectedVersion: created.version },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe('CANCELLED');

    const retry = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId, expectedVersion: created.version },
    });
    expect(retry.statusCode).toBe(200);
    const tables = (await app.inject({ method: 'GET', url: '/tables', headers: auth() })).json();
    expect(tables.find((table: any) => table.id === table4).status).toBe('FREE');
    expect(tables.find((table: any) => table.id === table5).status).toBe('FREE');

    const sqlite = new Database(databasePath, { readonly: true });
    expect(
      sqlite
        .prepare(
          `SELECT actor_user_id AS actorUserId, action, before_json AS beforeJson,
                  after_json AS afterJson, COUNT(*) AS count
           FROM audit_log WHERE command_id = ?`,
        )
        .get(commandId),
    ).toMatchObject({ actorUserId: waiterId, action: 'ORDER_EMPTY_CANCELLED', count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM event_log WHERE command_id = ?').get(commandId),
    ).toEqual({ count: 1 });
    sqlite.close();
  });

  it('rejects simple cancellation with DRAFT items, then permits it after removing them', async () => {
    const created = (await createTableOrder([table4])).json();
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/items`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: created.version,
        productId,
      },
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: added.json().version },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe('ORDER_EMPTY_CANCEL_NOT_ALLOWED');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/orders/${created.id}/items/${added.json().items[0].id}`,
      headers: auth(),
      payload: { expectedVersion: added.json().version },
    });
    const cancelled = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: removed.json().version },
    });
    expect(cancelled.statusCode).toBe(200);
  });

  it('rejects simple cancellation after a Round or Payment exists', async () => {
    const created = (await createTableOrder([table6])).json();
    const added = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/items`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: created.version,
        productId,
      },
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/rounds`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: added.json().version },
    });
    const sentRejected = await app.inject({
      method: 'POST',
      url: `/orders/${created.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: sent.json().version },
    });
    expect(sentRejected.statusCode).toBe(409);
    expect(sentRejected.json().error).toBe('ORDER_EMPTY_CANCEL_NOT_ALLOWED');

    const paidOrder = (await createTableOrder([table7])).json();
    const paidAdded = await app.inject({
      method: 'POST',
      url: `/orders/${paidOrder.id}/items`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: paidOrder.version,
        productId,
      },
    });
    const paidSent = await app.inject({
      method: 'POST',
      url: `/orders/${paidOrder.id}/rounds`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: paidAdded.json().version },
    });
    await app.inject({
      method: 'POST',
      url: '/cash-sessions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        commandId: crypto.randomUUID(),
        openingFloatAmount: 0,
        businessDate: '2026-08-27',
      },
    });
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${paidOrder.id}/payments`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: paidSent.json().version,
        method: 'CASH',
        amountApplied: 1000,
        tip: { type: 'NONE' },
        cashTendered: 1000,
      },
    });
    expect(paid.statusCode).toBe(200);
    const paymentRejected = await app.inject({
      method: 'POST',
      url: `/orders/${paidOrder.id}/cancel-empty`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: paid.json().version },
    });
    expect(paymentRejected.statusCode).toBe(409);
    expect(paymentRejected.json().error).toBe('ORDER_EMPTY_CANCEL_NOT_ALLOWED');
    expect(paymentRejected.json().details).toBeUndefined();
  });

  it('returns 403 to a valid role without Waiter permissions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tables',
      headers: { authorization: `Bearer ${kitchenToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('PERMISSION_DENIED');
  });

  it('keeps sequential POS/Waiter edits, KDS state and payment requests realtime without weakening OCC', async () => {
    const waiterSocket = await openRealtime(waiterToken);
    let posSocket = await openRealtime(ownerToken);
    let order = (await createTableOrder([table4])).json();

    const posInvalidation = waitForMessage(
      posSocket,
      (message) => message.type === 'ORDER_UPDATED' && message.orderId === order.id,
    );
    const firstAdded = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/items`,
      headers: auth(),
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        productId,
      },
    });
    expect(firstAdded.statusCode).toBe(200);
    await expect(posInvalidation).resolves.toMatchObject({
      reason: 'ITEM_ADDED',
      version: firstAdded.json().version,
    });

    posSocket.close();
    posSocket = await openRealtime(ownerToken);
    const refetchedAfterReconnect = await app.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(refetchedAfterReconnect.statusCode).toBe(200);
    expect(refetchedAfterReconnect.json()).toMatchObject({
      id: order.id,
      version: firstAdded.json().version,
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/items`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { commandId: crypto.randomUUID(), expectedVersion: order.version, productId },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('STALE_ORDER_VERSION');

    order = (
      await app.inject({
        method: 'GET',
        url: `/orders/${order.id}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      })
    ).json();
    expect(order.items).toHaveLength(1);

    const waiterInvalidation = waitForMessage(
      waiterSocket,
      (message) => message.type === 'ORDER_UPDATED' && message.orderId === order.id,
    );
    const secondAdded = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/items`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        productId,
      },
    });
    await expect(waiterInvalidation).resolves.toMatchObject({ reason: 'ITEM_ADDED' });
    order = (
      await app.inject({ method: 'GET', url: `/orders/${order.id}`, headers: auth() })
    ).json();
    expect(order.items).toHaveLength(2);

    const removeInvalidation = waitForMessage(
      posSocket,
      (message) => message.type === 'ORDER_UPDATED' && message.reason === 'ITEM_REMOVED',
    );
    const removed = await app.inject({
      method: 'DELETE',
      url: `/orders/${order.id}/items/${order.items[0].id}`,
      headers: auth(),
      payload: { expectedVersion: order.version },
    });
    await removeInvalidation;
    order = removed.json();
    expect(order.items).toHaveLength(1);

    const sent = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/rounds`,
      headers: auth(),
      payload: { commandId: crypto.randomUUID(), expectedVersion: order.version },
    });
    order = sent.json();
    expect(order.items.every((item: any) => item.status === 'SENT')).toBe(true);

    const started = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${order.rounds[0].id}/${stationId}/preparing`,
      headers: { authorization: `Bearer ${kitchenToken}` },
      payload: { commandId: crypto.randomUUID() },
    });
    expect(started.statusCode).toBe(200);
    const ready = await app.inject({
      method: 'POST',
      url: `/kds/tickets/${order.rounds[0].id}/${stationId}/ready`,
      headers: { authorization: `Bearer ${kitchenToken}` },
      payload: { commandId: crypto.randomUUID() },
    });
    expect(ready.statusCode).toBe(200);
    let table = (
      await app.inject({ method: 'GET', url: '/tables', headers: auth() })
    ).json().find((candidate: any) => candidate.id === table4);
    expect(table).toMatchObject({ status: 'READY', readyItemCount: 1 });

    const paymentRequestCommand = crypto.randomUUID();
    const paymentRequested = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payment-request`,
      headers: auth(),
      payload: { commandId: paymentRequestCommand, expectedVersion: order.version },
    });
    expect(paymentRequested.statusCode).toBe(200);
    order = paymentRequested.json();
    expect(order).toMatchObject({ status: 'OPEN', paymentRequestedAt: expect.any(String) });
    const paymentRequestRetry = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payment-request`,
      headers: auth(),
      payload: { commandId: paymentRequestCommand, expectedVersion: order.version - 1 },
    });
    expect(paymentRequestRetry.statusCode).toBe(200);
    expect(paymentRequestRetry.json().version).toBe(order.version);
    table = (await app.inject({ method: 'GET', url: '/tables', headers: auth() }))
      .json()
      .find((candidate: any) => candidate.id === table4);
    expect(table.status).toBe('PAYMENT_REQUESTED');

    const currentCash = await app.inject({
      method: 'GET',
      url: '/cash-sessions/current',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    if (!currentCash.json().session) {
      await app.inject({
        method: 'POST',
        url: '/cash-sessions',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { commandId: crypto.randomUUID(), openingFloatAmount: 0, businessDate: '2026-08-27' },
      });
    }
    const paid = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        commandId: crypto.randomUUID(),
        expectedVersion: order.version,
        method: 'CASH',
        amountApplied: order.balanceDue.amount,
        tip: { type: 'NONE' },
        cashTendered: order.balanceDue.amount,
      },
    });
    const closed = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/close`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { commandId: crypto.randomUUID(), expectedVersion: paid.json().version },
    });
    expect(closed.statusCode).toBe(200);
    table = (await app.inject({ method: 'GET', url: '/tables', headers: auth() }))
      .json()
      .find((candidate: any) => candidate.id === table4);
    expect(table.status).toBe('FREE');
    waiterSocket.close();
    posSocket.close();
  });

  it('restores table occupancy and the Waiter session after an Edge restart', async () => {
    await app.close();
    app = await buildApp(databasePath, { startPrintWorker: false });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/tables', headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().filter((table: any) => table.status !== 'FREE')).toHaveLength(5);
  });
});
