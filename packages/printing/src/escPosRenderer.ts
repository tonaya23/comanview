import type { PrintJob, PrintMoneySnapshot } from './types.js';

const ESC = 0x1b;
const GS = 0x1d;
const encoder = new TextEncoder();

function money(value: PrintMoneySnapshot): string {
  const sign = value.amount < 0 ? '-' : '';
  const absolute = Math.abs(value.amount);
  return `${sign}${value.currency} ${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

/**
 * Minimal deterministic ESC/POS document for TCP printers.
 * Text is UTF-8; printer-specific code pages are intentionally deferred.
 */
export function renderEscPosTicket(job: PrintJob): Uint8Array {
  const payload = job.payload;
  const chunks: Uint8Array[] = [];
  const command = (...bytes: number[]) => chunks.push(Uint8Array.from(bytes));
  const line = (value = '') => {
    chunks.push(text(value));
    command(0x0a);
  };

  command(ESC, 0x40); // Initialize.
  command(ESC, 0x61, 0x01); // Center.
  command(ESC, 0x45, 0x01); // Bold on.
  line(payload.kind === 'STATION_TICKET' ? payload.stationName : 'COMANVIEW');
  line(job.jobType.replaceAll('_', ' '));
  command(ESC, 0x45, 0x00); // Bold off.
  command(ESC, 0x61, 0x00); // Left.
  line(`ORDER: ${payload.orderNumber}`);
  if (payload.kind === 'STATION_TICKET') line(`ROUND: ${payload.roundNumber}`);
  line();

  command(ESC, 0x45, 0x01);
  line('ITEMS');
  command(ESC, 0x45, 0x00);
  for (const item of payload.items) {
    line(`${item.quantity} x ${item.productName}  ${money(item.lineTotal)}`);
    for (const modifier of item.modifiers) {
      line(`  + ${modifier.name}  ${money(modifier.priceDelta)}`);
    }
    if (item.specialInstructions) line(`  NOTE: ${item.specialInstructions}`);
  }

  if (payload.kind !== 'STATION_TICKET') {
    line();
    line(`SUBTOTAL: ${money(payload.subtotal)}`);
    line(`PAID: ${money(payload.paidAmount)}`);
    line(`BALANCE: ${money(payload.balanceDue)}`);
    line(`TIPS: ${money(payload.tipTotal)}`);
  }

  if (payload.kind === 'CUSTOMER_RECEIPT') {
    line();
    command(ESC, 0x45, 0x01);
    line('PAYMENTS');
    command(ESC, 0x45, 0x00);
    for (const payment of payload.payments) {
      line(`${payment.method}: ${money(payment.amountApplied)} + TIP ${money(payment.tipAmount)}`);
      if (payment.cashTendered) line(`  TENDERED: ${money(payment.cashTendered)}`);
      if (payment.changeGiven.amount > 0) line(`  CHANGE: ${money(payment.changeGiven)}`);
    }
  }

  command(ESC, 0x64, 0x03); // Feed three lines.
  command(GS, 0x56, 0x00); // Full cut.

  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
