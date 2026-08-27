import { describe, expect, it, vi } from 'vitest';
import { PrintWorker } from './PrintWorker.js';
import { PrinterAdapterError, type PrintJob, type PrintQueue, type PrintTarget } from './types.js';
import { renderDebugTicket } from './renderer.js';
import { renderEscPosTicket } from './escPosRenderer.js';

const job = {
  printJobId: '01991a00-0000-7000-8000-000000000901',
  tenantId: 't',
  locationId: 'l',
  orderId: 'o',
  roundId: 'r',
  stationId: 's',
  targetId: 'p',
  jobType: 'STATION_TICKET',
  status: 'SENDING',
  attempts: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  nextAttemptAt: null,
  lastError: null,
  parentJobId: null,
  dedupeKey: 'round:r:station:s',
  payload: {
    kind: 'STATION_TICKET',
    orderId: 'o',
    orderNumber: 'A-1',
    orderType: 'COUNTER',
    tableIds: [],
    capturedAt: new Date().toISOString(),
    roundId: 'r',
    roundNumber: 1,
    roundSentAt: new Date().toISOString(),
    stationId: 's',
    stationName: 'COCINA',
    items: [
      {
        orderItemId: 'i',
        productId: 'p',
        productName: 'Burger',
        quantity: 1,
        unitPrice: { amount: 1000, currency: 'MXN' },
        lineTotal: { amount: 1200, currency: 'MXN' },
        modifiers: [
          { modifierOptionId: 'm', name: 'Queso', priceDelta: { amount: 200, currency: 'MXN' } },
        ],
        specialInstructions: 'Sin cebolla',
        stationId: 's',
        stationName: 'COCINA',
      },
    ],
  },
} satisfies PrintJob;
const target = {
  targetId: 'p',
  tenantId: 't',
  locationId: 'l',
  stationId: 's',
  name: 'Kitchen',
  adapterType: 'DEBUG',
  active: true,
  configuration: {},
} satisfies PrintTarget;

const zReportJob = {
  ...job,
  printJobId: '01991a00-0000-7000-8000-000000000903',
  orderId: null,
  cashSessionId: '01991a00-0000-7000-8000-000000000904',
  roundId: null,
  stationId: null,
  jobType: 'Z_REPORT',
  dedupeKey: 'cash-report:z-command',
  payload: {
    kind: 'Z_REPORT',
    cashSessionId: '01991a00-0000-7000-8000-000000000904',
    businessDate: '2026-08-26',
    capturedAt: '2026-08-27T03:00:00.000Z',
    openingFloat: { amount: 100_000, currency: 'MXN' },
    cashSales: { amount: 3_200, currency: 'MXN' },
    cardSales: { amount: 3_800, currency: 'MXN' },
    otherSales: { amount: 0, currency: 'MXN' },
    cashTips: { amount: 800, currency: 'MXN' },
    cardTips: { amount: 0, currency: 'MXN' },
    otherTips: { amount: 0, currency: 'MXN' },
    cashIn: { amount: 10_000, currency: 'MXN' },
    cashOut: { amount: 5_000, currency: 'MXN' },
    expectedCash: { amount: 109_000, currency: 'MXN' },
    countedCash: { amount: 110_000, currency: 'MXN' },
    difference: { amount: 1_000, currency: 'MXN' },
  },
} satisfies PrintJob;

describe('printing', () => {
  it('renders modifier and special instructions from the historical payload', () => {
    expect(renderDebugTicket(job)).toContain('Queso');
    expect(renderDebugTicket(job)).toContain('NOTE: Sin cebolla');
  });
  it('renders a durable Z cash snapshot for debug and ESC/POS adapters', () => {
    expect(renderDebugTicket(zReportJob)).toContain('DIFFERENCE: MXN 10.00');
    expect(new TextDecoder().decode(renderEscPosTicket(zReportJob))).toContain(
      'EXPECTED: MXN 1090.00',
    );
  });
  it('marks a successful delivery', async () => {
    const queue = {
      recoverInterruptedJobs: vi.fn(),
      claimNext: vi.fn(() => ({ job, target })),
      markDelivered: vi.fn(),
      markFailed: vi.fn(),
      markUnknown: vi.fn(),
    } satisfies PrintQueue;
    await new PrintWorker(queue, {
      print: vi.fn(async () => ({ outcome: 'DELIVERED' as const })),
    }).processNext();
    expect(queue.markDelivered).toHaveBeenCalledWith(job.printJobId, undefined);
  });
  it('records a safe retry after failure before transmission', async () => {
    const queue = {
      recoverInterruptedJobs: vi.fn(),
      claimNext: vi.fn(() => ({ job, target })),
      markDelivered: vi.fn(),
      markFailed: vi.fn(),
      markUnknown: vi.fn(),
    } satisfies PrintQueue;
    await new PrintWorker(
      queue,
      {
        print: vi.fn(async () => {
          throw new PrinterAdapterError('offline', 'NOT_STARTED');
        }),
      },
      { retryDelayMs: 10 },
    ).processNext(new Date(0));
    expect(queue.markFailed).toHaveBeenCalledWith(job.printJobId, 'offline', new Date(10));
  });
});
