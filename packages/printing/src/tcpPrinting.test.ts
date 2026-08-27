import { describe, expect, it } from 'vitest';
import { TcpPrinterAdapter } from './TcpPrinterAdapter.js';
import { renderEscPosTicket } from './escPosRenderer.js';
import { PrinterAdapterError, type PrintJob, type PrintTarget } from './types.js';
import { VirtualTcpPrinter } from './testing/VirtualTcpPrinter.js';

const job: PrintJob = {
  printJobId: '01991a00-0000-7000-8000-000000000901',
  tenantId: 'tenant',
  locationId: 'location',
  orderId: 'order',
  roundId: 'round',
  stationId: 'station',
  targetId: 'target',
  jobType: 'STATION_TICKET',
  status: 'SENDING',
  attempts: 1,
  createdAt: new Date('2026-08-26T12:00:00.000Z'),
  updatedAt: new Date('2026-08-26T12:00:00.000Z'),
  nextAttemptAt: null,
  lastError: null,
  parentJobId: null,
  dedupeKey: 'round:round:station:station',
  payload: {
    kind: 'STATION_TICKET',
    orderId: 'order',
    orderNumber: 'P-42',
    orderType: 'COUNTER',
    tableIds: [],
    capturedAt: '2026-08-26T12:00:00.000Z',
    roundId: 'round',
    roundNumber: 1,
    roundSentAt: '2026-08-26T12:00:00.000Z',
    stationId: 'station',
    stationName: 'COCINA',
    items: [
      {
        orderItemId: 'item',
        productId: 'product',
        productName: 'Hamburguesa clásica',
        quantity: 1,
        unitPrice: { amount: 12900, currency: 'MXN' },
        lineTotal: { amount: 13400, currency: 'MXN' },
        modifiers: [
          {
            modifierOptionId: 'modifier',
            name: 'Queso extra',
            priceDelta: { amount: 500, currency: 'MXN' },
          },
        ],
        specialInstructions: 'salsa aparte',
        stationId: 'station',
        stationName: 'COCINA',
      },
    ],
  },
};

function target(port: number): PrintTarget {
  return {
    targetId: 'target',
    tenantId: 'tenant',
    locationId: 'location',
    stationId: 'station',
    name: 'Cocina virtual',
    adapterType: 'TCP_ESC_POS',
    active: true,
    configuration: { host: '127.0.0.1', port },
  };
}

describe('TCP ESC/POS printing', () => {
  it('renders deterministic ESC/POS commands and ticket content', () => {
    const payload = renderEscPosTicket(job);
    expect([...payload.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...payload.slice(-3)]).toEqual([0x1d, 0x56, 0x00]);
    const decoded = new TextDecoder().decode(payload);
    expect(decoded).toContain('Hamburguesa clásica');
    expect(decoded).toContain('Queso extra');
    expect(decoded).toContain('NOTE: salsa aparte');
  });

  it('connects and transmits the complete byte payload to a virtual printer', async () => {
    const printer = new VirtualTcpPrinter();
    await printer.start();
    try {
      const result = await new TcpPrinterAdapter().print(job, target(printer.port));
      const received = await printer.waitForPayload();
      expect(result.outcome).toBe('DELIVERED');
      expect([...received]).toEqual([...renderEscPosTicket(job)]);
    } finally {
      await printer.stop();
    }
  });

  it('reports a refused connection as safe to retry', async () => {
    const printer = new VirtualTcpPrinter();
    await printer.start();
    const closedPort = printer.port;
    await printer.stop();
    await expect(
      new TcpPrinterAdapter({ connectTimeoutMs: 100 }).print(job, target(closedPort)),
    ).rejects.toMatchObject({ transmission: 'NOT_STARTED' } satisfies Partial<PrinterAdapterError>);
  });
});
