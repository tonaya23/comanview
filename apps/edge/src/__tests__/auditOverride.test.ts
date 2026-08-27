import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { createEdgeClient, type EdgeClient } from '@comanview/client-sdk';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { buildApp } from '../index.js';

const POS_DEVICE_ID = '01991a00-0000-7000-8000-000000000721';
const CASHIER_ID = '01991a00-0000-7000-8000-000000000712';
const OWNER_ID = '01991a00-0000-7000-8000-000000000711';
const MANAGER_ID = '01991a00-0000-7000-8000-000000000716';
const LOCATION_ID = '01991a00-0000-7000-8000-000000000302';

describe('durable Audit Log and single-operation Manager Override', () => {
  const dbPath = join(tmpdir(), `comanview-audit-${Date.now()}.db`);
  let app: FastifyInstance;
  let baseUrl = '';
  let cashierToken = '';
  let ownerToken = '';
  let cashier: EdgeClient;
  let owner: EdgeClient;

  async function startEdge() {
    app = await buildApp(dbPath, { startPrintWorker: false });
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  }

  async function createPaidOrder() {
    const water = (await cashier.getProducts()).find(({ name }) => name === 'Agua mineral')!;
    const created = await cashier.createOrder({
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
    });
    const added = await cashier.addOrderItem(created.id, {
      commandId: crypto.randomUUID(),
      expectedVersion: created.version,
      productId: water.id,
    });
    const paid = await cashier.createPayment(created.id, {
      commandId: crypto.randomUUID(),
      expectedVersion: added.version,
      method: 'CASH',
      amountApplied: 1000,
      tip: { type: 'NONE' },
      cashTendered: 1000,
    });
    return { order: paid, paymentId: paid.payments[0]!.id };
  }

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    await startEdge();
    cashier = createEdgeClient({ baseUrl, getAccessToken: () => cashierToken });
    owner = createEdgeClient({ baseUrl, getAccessToken: () => ownerToken });
    cashierToken = (await cashier.login({ pin: '2222', deviceId: POS_DEVICE_ID })).token;
    ownerToken = (await owner.login({ pin: '1111', deviceId: POS_DEVICE_ID })).token;
    await cashier.openCashSession({
      commandId: 'audit-open-cash',
      openingFloatAmount: 0,
      businessDate: '2026-08-27',
    });
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('requires override and rejects invalid, inactive or insufficient authorizers', async () => {
    const { order, paymentId } = await createPaidOrder();
    const request = {
      commandId: 'override-rejections',
      expectedVersion: order.version,
      reason: 'Pago capturado por error',
    };

    await expect(cashier.voidPayment(order.id, paymentId, request)).rejects.toMatchObject({
      status: 403,
      code: 'OVERRIDE_REQUIRED',
    });
    await expect(
      cashier.voidPayment(order.id, paymentId, { ...request, overridePin: '0000' }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_PIN_INVALID' });
    await expect(
      cashier.voidPayment(order.id, paymentId, { ...request, overridePin: '9999' }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_USER_INACTIVE' });
    await expect(
      cashier.voidPayment(order.id, paymentId, { ...request, overridePin: '3333' }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_PERMISSION_DENIED' });
    await expect(
      cashier.voidPayment(order.id, paymentId, {
        commandId: 'reason-required',
        expectedVersion: order.version,
        reason: '   ',
        overridePin: '5555',
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    const unchanged = await cashier.getOrder(order.id);
    expect(unchanged.version).toBe(order.version);
    expect(unchanged.payments[0]!.status).toBe('COMPLETED');
    expect((await owner.getAuditEntries({ resourceId: paymentId })).entries).toHaveLength(0);
  });

  it('uses Manager and Owner PINs for exactly one idempotent action without elevating CASHIER', async () => {
    const managerCase = await createPaidOrder();
    const managerRequest = {
      commandId: 'manager-override-void',
      expectedVersion: managerCase.order.version,
      reason: '  Registro duplicado en terminal  ',
      overridePin: '5555',
    };
    const managerVoided = await cashier.voidPayment(
      managerCase.order.id,
      managerCase.paymentId,
      managerRequest,
    );
    expect(managerVoided.payments[0]!.status).toBe('VOIDED');
    await cashier.voidPayment(managerCase.order.id, managerCase.paymentId, managerRequest);
    await expect(
      cashier.voidPayment(managerCase.order.id, managerCase.paymentId, {
        ...managerRequest,
        reason: 'Motivo diferente',
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });

    const session = await cashier.getCurrentSession();
    expect(session.user.id).toBe(CASHIER_ID);
    expect(session.user.permissions).not.toContain('PAYMENT_VOID');
    await expect(cashier.getAuditEntries()).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    });

    const managerAudit = (
      await owner.getAuditEntries({ resourceId: managerCase.paymentId })
    ).entries;
    expect(managerAudit).toHaveLength(1);
    expect(managerAudit[0]).toMatchObject({
      actorUserId: CASHIER_ID,
      actorRole: 'CASHIER',
      authorizedByUserId: MANAGER_ID,
      authorizedByRole: 'MANAGER',
      locationId: LOCATION_ID,
      deviceId: POS_DEVICE_ID,
      action: 'PAYMENT_VOIDED',
      entityType: 'PAYMENT',
      entityId: managerCase.paymentId,
      outcome: 'SUCCESS',
      reason: 'Registro duplicado en terminal',
      commandId: managerRequest.commandId,
      before: { status: 'COMPLETED' },
      after: { status: 'VOIDED' },
      amountAffected: 1000,
      currency: 'MXN',
    });
    expect(Number.isNaN(Date.parse(managerAudit[0]!.occurredAt))).toBe(false);
    expect(managerAudit[0]!.entryHash).toHaveLength(64);

    const ownerCase = await createPaidOrder();
    await cashier.voidPayment(ownerCase.order.id, ownerCase.paymentId, {
      commandId: 'owner-override-void',
      expectedVersion: ownerCase.order.version,
      reason: 'Cliente cambió método de pago',
      overridePin: '1111',
    });
    const ownerAudit = (await owner.getAuditEntries({ resourceId: ownerCase.paymentId })).entries;
    expect(ownerAudit).toHaveLength(1);
    expect(ownerAudit[0]!.actorUserId).toBe(CASHIER_ID);
    expect(ownerAudit[0]!.authorizedByUserId).toBe(OWNER_ID);
    expect(ownerAudit[0]!.previousHash).toBe(managerAudit[0]!.entryHash);

    const serialized = JSON.stringify([...managerAudit, ...ownerAudit]);
    expect(serialized).not.toContain('5555');
    expect(serialized).not.toContain('1111');
    expect(serialized).not.toContain(cashierToken);
    expect(serialized).not.toContain(ownerToken);
    expect(serialized).not.toContain('pinHash');
    expect(serialized).not.toContain('tokenHash');
  });

  it('does not write SUCCESS for failed mutations and rolls back when audit persistence fails', async () => {
    const staleCase = await createPaidOrder();
    await expect(
      cashier.voidPayment(staleCase.order.id, staleCase.paymentId, {
        commandId: 'stale-void-no-audit',
        expectedVersion: staleCase.order.version + 1,
        reason: 'Versión inválida',
        overridePin: '5555',
      }),
    ).rejects.toMatchObject({ code: 'STALE_ORDER_VERSION' });
    expect((await owner.getAuditEntries({ resourceId: staleCase.paymentId })).entries).toHaveLength(
      0,
    );

    const atomicCase = await createPaidOrder();
    const Database = require('better-sqlite3');
    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TRIGGER fail_required_audit
      BEFORE INSERT ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'controlled audit failure');
      END;
    `);
    try {
      await expect(
        cashier.voidPayment(atomicCase.order.id, atomicCase.paymentId, {
          commandId: 'atomic-audit-failure',
          expectedVersion: atomicCase.order.version,
          reason: 'Fallo controlado',
          overridePin: '5555',
        }),
      ).rejects.toMatchObject({ status: 500, code: 'AUDIT_PERSISTENCE_FAILED' });
    } finally {
      sqlite.exec('DROP TRIGGER fail_required_audit');
      sqlite.close();
    }
    const unchanged = await cashier.getOrder(atomicCase.order.id);
    expect(unchanged.version).toBe(atomicCase.order.version);
    expect(unchanged.payments[0]!.status).toBe('COMPLETED');
    expect((await owner.getAuditEntries({ resourceId: atomicCase.paymentId })).entries).toHaveLength(
      0,
    );
  });

  it('keeps Audit Log append-only and durable across Edge restart', async () => {
    const beforeRestart = await owner.getAuditEntries({ action: 'PAYMENT_VOIDED' });
    expect(beforeRestart.entries.length).toBe(2);

    const deleteResponse = await fetch(`${baseUrl}/audit/${beforeRestart.entries[0]!.auditId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(deleteResponse.status).toBe(404);

    await app.close();
    await startEdge();
    owner = createEdgeClient({ baseUrl, getAccessToken: () => ownerToken });
    const restored = await owner.getAuditEntries({ action: 'PAYMENT_VOIDED' });
    expect(restored.entries).toEqual(beforeRestart.entries);
  });
});
