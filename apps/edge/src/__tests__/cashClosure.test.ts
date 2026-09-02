import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { createEdgeClient, type EdgeClient } from '@comanview/client-sdk';
import { prepareDevelopmentDatabase } from '@comanview/database';
import {
  PrinterAdapterError,
  type PrinterAdapter,
  type PrintJob,
  type PrintTarget,
} from '@comanview/printing';
import { buildApp } from '../index.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const POS_DEVICE_ID = '01991a00-0000-7000-8000-000000000721';
const CASHIER_ID = '01991a00-0000-7000-8000-000000000712';

class FailingPrinter implements PrinterAdapter {
  async print(_job: PrintJob, _target: PrintTarget): Promise<never> {
    throw new PrinterAdapterError('Controlled cash report printer failure.', 'NOT_STARTED');
  }
}

describe('Cash operations, blind count and X/Z closure', () => {
  const dbPath = join(tmpdir(), `comanview-cash-closure-${Date.now()}.db`);
  let app: FastifyInstance;
  let cashierToken = '';
  let ownerToken = '';
  let waiterToken = '';
  let cashier: EdgeClient;
  let owner: EdgeClient;
  let waiter: EdgeClient;
  const failedPostZBackup = vi.fn(() => { throw new Error('Controlled post-Z backup failure.'); });

  async function startEdge() {
    app = await buildApp(dbPath, { printerAdapter: new FailingPrinter(), onPostZBackup: failedPostZBackup });
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    cashier = createEdgeClient({ baseUrl, getAccessToken: () => cashierToken });
    owner = createEdgeClient({ baseUrl, getAccessToken: () => ownerToken });
    waiter = createEdgeClient({ baseUrl, getAccessToken: () => waiterToken });
  }

  async function createPayment(method: 'CASH' | 'CARD', productName: string) {
    const product = (await cashier.getProducts()).find(({ name }) => name === productName)!;
    const order = await cashier.createOrder({
      orderType: 'COUNTER',
      channel: 'POS',
      currency: 'MXN',
    });
    const added = await cashier.addOrderItem(order.id, {
      commandId: crypto.randomUUID(),
      expectedVersion: order.version,
      productId: product.id,
    });
    return cashier.createPayment(order.id, {
      commandId: crypto.randomUUID(),
      expectedVersion: added.version,
      method,
      amountApplied: product.basePrice.amount,
      tip: method === 'CASH' ? { type: 'FIXED_AMOUNT' as const, amount: 800 } : { type: 'NONE' as const },
      ...(method === 'CASH' ? { cashTendered: product.basePrice.amount + 800 } : {}),
    });
  }

  beforeAll(async () => {
    prepareDevelopmentDatabase(dbPath);
    await startEdge();
    cashierToken = (await cashier.login({ pin: '2222', deviceId: POS_DEVICE_ID,deviceCredential:'comanview-development-pos-device-credential-0001' })).token;
    ownerToken = (await owner.login({ pin: '1111', deviceId: POS_DEVICE_ID,deviceCredential:'comanview-development-pos-device-credential-0001' })).token;
    waiterToken = (await waiter.login({ pin: '3333', deviceId: POS_DEVICE_ID,deviceCredential:'comanview-development-pos-device-credential-0001' })).token;
  });

  afterAll(async () => {
    await app.close();
    for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it('runs the complete offline cash cycle with durable, atomic and idempotent closure', async () => {
    const opened = await cashier.openCashSession({
      commandId: 'open-cash-1n',
      openingFloatAmount: 100_000,
      businessDate: '2026-08-26',
    });
    expect(opened.expectedCash).toBeNull();
    expect(opened.businessDate).toBe('2026-08-26');
    await expect(
      waiter.createCashMovement({
        commandId: 'waiter-cash-in-denied',
        type: 'CASH_IN',
        amount: 100,
        reason: 'No autorizado',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
    await expect(waiter.generateXReport({ commandId: 'waiter-x-denied' })).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    });
    await expect(waiter.previewCashClosing({ countedCashAmount: 0 })).rejects.toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    });

    await createPayment('CASH', 'Agua mineral');
    await createPayment('CARD', 'Café americano');
    const cashIn = await cashier.createCashMovement({
      commandId: 'cash-in-1n',
      type: 'CASH_IN',
      amount: 10_000,
      reason: 'Cambio adicional',
    });
    expect(cashIn.expectedCash.amount).toBe(114_000);
    const cashOut = await cashier.createCashMovement({
      commandId: 'cash-out-1n',
      type: 'CASH_OUT',
      amount: 5_000,
      reason: 'Compra urgente de insumos',
    });
    expect(cashOut.expectedCash.amount).toBe(109_000);

    const x = await cashier.generateXReport({ commandId: 'x-report-1n' });
    expect(x).toMatchObject({
      reportType: 'X',
      businessDate: '2026-08-26',
      expectedCash: { amount: 109_000, currency: 'MXN' },
      cashIn: { amount: 10_000, currency: 'MXN' },
      cashOut: { amount: 5_000, currency: 'MXN' },
      countedCash: null,
      difference: null,
    });
    expect(x.salesByMethod.CASH.amount).toBe(3_200);
    expect(x.salesByMethod.CARD.amount).toBe(3_800);
    expect(x.tipsByMethod.CASH.amount).toBe(800);
    expect((await cashier.getCurrentCashSession()).session?.status).toBe('OPEN');

    const preview = await cashier.previewCashClosing({ countedCashAmount: 110_000 });
    expect(preview.expectedCash.amount).toBe(109_000);
    expect(preview.countedCash.amount).toBe(110_000);
    expect(preview.difference.amount).toBe(1_000);

    const blocker = new Database(dbPath);
    blocker.exec(`CREATE TRIGGER fail_z_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'CASH_SESSION_CLOSED'
      BEGIN SELECT RAISE(ABORT, 'controlled audit failure'); END;`);
    blocker.close();
    const closeRequest = { commandId: 'z-report-1n', countedCashAmount: 110_000 };
    await expect(cashier.closeCashSession(closeRequest)).rejects.toMatchObject({
      code: 'AUDIT_PERSISTENCE_FAILED',
    });
    expect((await cashier.getCurrentCashSession()).session?.status).toBe('OPEN');
    const unblocker = new Database(dbPath);
    unblocker.exec('DROP TRIGGER fail_z_audit;');
    unblocker.close();

    const closed = await cashier.closeCashSession(closeRequest);
    expect(closed.session).toMatchObject({
      status: 'CLOSED',
      businessDate: '2026-08-26',
      closedBy: CASHIER_ID,
      expectedCashAtClose: { amount: 109_000, currency: 'MXN' },
      countedCash: { amount: 110_000, currency: 'MXN' },
      difference: { amount: 1_000, currency: 'MXN' },
    });
    const retry = await cashier.closeCashSession(closeRequest);
    expect(retry.report.reportId).toBe(closed.report.reportId);
    expect((await cashier.getCurrentCashSession()).session).toBeNull();
    await expect(
      cashier.createCashMovement({
        commandId: 'movement-after-close',
        type: 'CASH_IN',
        amount: 100,
        reason: 'No permitido',
      }),
    ).rejects.toMatchObject({ code: 'CASH_SESSION_NOT_OPEN' });

    await new Promise((resolve) => setTimeout(resolve, 2_200));
    const zPrint = (await cashier.getRecentPrintJobs()).find(
      ({ printJobId }) => printJobId === closed.report.printJobId,
    );
    expect(zPrint?.status).toBe('FAILED');
    expect(closed.session.status).toBe('CLOSED');
    expect(failedPostZBackup).toHaveBeenCalledTimes(1);

    const audits = (await owner.getAuditEntries({ actorUserId: CASHIER_ID, limit: 20 })).entries;
    expect(audits.filter(({ action }) => action === 'CASH_MOVEMENT_CREATED')).toHaveLength(2);
    expect(audits.filter(({ action }) => action === 'CASH_X_REPORT_GENERATED')).toHaveLength(1);
    expect(audits.filter(({ action }) => action === 'CASH_SESSION_CLOSED')).toHaveLength(1);

    await app.close();
    await startEdge();
    expect((await cashier.getCurrentCashSession()).session).toBeNull();
    expect((await owner.getAuditEntries({ action: 'CASH_SESSION_CLOSED' })).entries).toHaveLength(1);
    const next = await cashier.openCashSession({
      commandId: 'open-cash-after-z',
      openingFloatAmount: 12_345,
      businessDate: '2026-08-27',
    });
    expect(next.openingFloat.amount).toBe(12_345);
    expect(next.businessDate).toBe('2026-08-27');
  }, 20_000);
});
