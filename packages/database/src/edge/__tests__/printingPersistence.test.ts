import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { EntityId, Order, ProductSnapshot } from '@comanview/domain';
import { Money } from '@comanview/money';
import { PrintWorker, TcpPrinterAdapter, VirtualTcpPrinter } from '@comanview/printing';
import * as schema from '../schema.js';
import { OrderRepository } from '../repositories/OrderRepository.js';
import { PrintJobRepository, type NewPrintJob } from '../repositories/PrintJobRepository.js';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0))
    for (const candidate of [path, `${path}-shm`, `${path}-wal`])
      if (existsSync(candidate)) unlinkSync(candidate);
});

function openDb() {
  const path = join(tmpdir(), `comanview-print-queue-${Date.now()}-${Math.random()}.db`);
  paths.push(path);
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
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
    '0012_signed_licensing_configuration.sql',
  ]) {
    sqlite.exec(readFileSync(join(process.cwd(), '../../migrations/edge', migration), 'utf8'));
  }
  return { path, sqlite, db: drizzle(sqlite, { schema }) };
}

function makeSentOrder() {
  const order = Order.create({
    tenantId: EntityId.generate(),
    locationId: EntityId.generate(),
    orderType: 'COUNTER',
    orderChannel: 'POS',
    orderNumber: 'P-1',
    currency: 'MXN',
  });
  const stationId = EntityId.generate();
  order.addItem(
    new ProductSnapshot({
      productId: EntityId.generate(),
      productName: 'Burger snapshot',
      basePrice: Money.fromMinorUnits(1000, 'MXN'),
      taxRateBasisPoints: 1600,
      taxCalculationMode: 'TAX_INCLUDED',
      stationId,
      modifiers: [],
    }),
    'add',
    'bien cocida',
  );
  const round = order.sendDraftItems('send');
  return { order, round, stationId };
}

function makeJob(
  order: ReturnType<typeof makeSentOrder>['order'],
  roundId: string,
  targetId: string | null,
): NewPrintJob {
  const createdAt = new Date();
  const item = order.items[0]!;
  return {
    printJobId: EntityId.generate().toString(),
    tenantId: order.tenantId.toString(),
    locationId: order.locationId.toString(),
    orderId: order.id.toString(),
    roundId,
    stationId: item.snapshot.stationId!.toString(),
    targetId,
    jobType: 'STATION_TICKET',
    createdAt,
    parentJobId: null,
    dedupeKey: `round:${roundId}:station:${item.snapshot.stationId!.toString()}`,
    payload: {
      kind: 'STATION_TICKET',
      orderId: order.id.toString(),
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableIds: [],
      capturedAt: createdAt.toISOString(),
      roundId,
      roundNumber: 1,
      roundSentAt: createdAt.toISOString(),
      stationId: item.snapshot.stationId!.toString(),
      stationName: 'COCINA',
      items: [
        {
          orderItemId: item.id.toString(),
          productId: item.snapshot.productId.toString(),
          productName: item.snapshot.productName,
          quantity: 1,
          unitPrice: { amount: 1000, currency: 'MXN' },
          lineTotal: { amount: 1000, currency: 'MXN' },
          modifiers: [],
          specialInstructions: item.specialInstructions,
          stationId: item.snapshot.stationId!.toString(),
          stationName: 'COCINA',
        },
      ],
    },
  };
}

describe('persistent print queue', () => {
  it('persists the Round and its PrintJob atomically and keeps payload after reopen', () => {
    const { path, sqlite, db } = openDb();
    const { order, round } = makeSentOrder();
    const repo = new OrderRepository(db);
    repo.saveOrder(order, true, 'send', [makeJob(order, round.id.toString(), null)]);
    sqlite.close();
    const reopened = new Database(path);
    const reopenedDb = drizzle(reopened, { schema });
    const jobs = new PrintJobRepository(reopenedDb).listRecent();
    expect(jobs).toHaveLength(1);
    const payload = jobs[0]!.payload;
    expect(payload.kind).toBe('STATION_TICKET');
    if (payload.kind !== 'STATION_TICKET') throw new Error('Expected station ticket payload.');
    expect(payload.items[0]!.specialInstructions).toBe('bien cocida');
    expect(new OrderRepository(reopenedDb).getOrderById(order.id)!.rounds).toHaveLength(1);
    reopened.close();
  });

  it('rolls back Order/Round when the controlled enqueue fails', () => {
    const { sqlite, db } = openDb();
    const { order, round } = makeSentOrder();
    expect(() =>
      new OrderRepository(db).saveOrder(order, true, 'atomic-failure', [
        makeJob(order, round.id.toString(), EntityId.generate().toString()),
      ]),
    ).toThrow();
    expect(
      db.select().from(schema.orders).where(eq(schema.orders.id, order.id.toString())).get(),
    ).toBeUndefined();
    expect(db.select().from(schema.printJobs).all()).toHaveLength(0);
    sqlite.close();
  });

  it('retries a refused TCP connection without changing Order/Round or duplicating the job', async () => {
    const { sqlite, db } = openDb();
    const { order, round, stationId } = makeSentOrder();
    const unavailablePrinter = new VirtualTcpPrinter();
    await unavailablePrinter.start();
    const unavailablePort = unavailablePrinter.port;
    await unavailablePrinter.stop();
    const targetId = EntityId.generate().toString();
    db.insert(schema.stations)
      .values({
        id: stationId.toString(),
        tenantId: order.tenantId.toString(),
        locationId: order.locationId.toString(),
        name: 'COCINA',
        active: true,
      })
      .run();
    db.insert(schema.printTargets)
      .values({
        id: targetId,
        tenantId: order.tenantId.toString(),
        locationId: order.locationId.toString(),
        stationId: stationId.toString(),
        name: 'TCP virtual',
        adapterType: 'TCP_ESC_POS',
        configurationJson: JSON.stringify({ host: '127.0.0.1', port: unavailablePort }),
        active: true,
      })
      .run();
    new OrderRepository(db).saveOrder(order, true, 'send-retry', [
      makeJob(order, round.id.toString(), targetId),
    ]);
    const queue = new PrintJobRepository(db);
    const failing = new PrintWorker(queue, new TcpPrinterAdapter({ connectTimeoutMs: 100 }), {
      retryDelayMs: 1,
    });
    await failing.processNext(new Date());
    expect(queue.listRecent()[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(new OrderRepository(db).getOrderById(order.id)!.rounds).toHaveLength(1);
    expect(queue.listRecent()).toHaveLength(1);

    const availablePrinter = new VirtualTcpPrinter();
    await availablePrinter.start();
    try {
      db.update(schema.printTargets)
        .set({
          configurationJson: JSON.stringify({ host: '127.0.0.1', port: availablePrinter.port }),
        })
        .where(eq(schema.printTargets.id, targetId))
        .run();
      await new PrintWorker(queue, new TcpPrinterAdapter()).processNext(new Date(Date.now() + 10));
      const received = new TextDecoder().decode(await availablePrinter.waitForPayload());
      expect(received).toContain('Burger snapshot');
      expect(received).toContain('NOTE: bien cocida');
      expect(queue.listRecent()).toHaveLength(1);
      expect(queue.listRecent()[0]).toMatchObject({ status: 'DELIVERED', attempts: 2 });
      expect(new OrderRepository(db).getOrderById(order.id)!.rounds).toHaveLength(1);
    } finally {
      await availablePrinter.stop();
      sqlite.close();
    }
  });

  it('converts a crash-left SENDING job to UNKNOWN instead of blind retry', () => {
    const { sqlite, db } = openDb();
    const { order, round } = makeSentOrder();
    new OrderRepository(db).saveOrder(order, true, 'send-crash', [
      makeJob(order, round.id.toString(), null),
    ]);
    const queue = new PrintJobRepository(db);
    expect(queue.claimNext(new Date())!.job.status).toBe('SENDING');
    expect(queue.recoverInterruptedJobs()).toBe(1);
    expect(queue.listRecent()[0]!.status).toBe('UNKNOWN');
    sqlite.close();
  });
});
