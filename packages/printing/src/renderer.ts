import type { PrintJob, PrintMoneySnapshot } from './types.js';

function money(value: PrintMoneySnapshot): string {
  const sign = value.amount < 0 ? '-' : '';
  const absolute = Math.abs(value.amount);
  return `${sign}${value.currency} ${(absolute / 100).toFixed(2)}`;
}

export function renderDebugTicket(job: PrintJob): string {
  const payload = job.payload;
  if ('cashSessionId' in payload) {
    const lines = [
      'COMANVIEW DEBUG TICKET',
      `TYPE: ${payload.kind}`,
      `SESSION: ${payload.cashSessionId}`,
      `BUSINESS DATE: ${payload.businessDate}`,
      `CAPTURED: ${payload.capturedAt}`,
      '',
      `OPENING FLOAT: ${money(payload.openingFloat)}`,
      `CASH SALES: ${money(payload.cashSales)}`,
      `CARD SALES: ${money(payload.cardSales)}`,
      `OTHER SALES: ${money(payload.otherSales)}`,
      `CASH TIPS: ${money(payload.cashTips)}`,
      `CARD TIPS: ${money(payload.cardTips)}`,
      `OTHER TIPS: ${money(payload.otherTips)}`,
      `CASH IN: ${money(payload.cashIn)}`,
      `CASH OUT: ${money(payload.cashOut)}`,
      `EXPECTED CASH: ${money(payload.expectedCash)}`,
    ];
    if (payload.countedCash) lines.push(`COUNTED CASH: ${money(payload.countedCash)}`);
    if (payload.difference) lines.push(`DIFFERENCE: ${money(payload.difference)}`);
    return `${lines.join('\n')}\n`;
  }
  const lines = [
    'COMANVIEW DEBUG TICKET',
    `TYPE: ${job.jobType}`,
    `JOB: ${job.printJobId}`,
    `ORDER: ${payload.orderNumber} (${payload.orderId})`,
    `ORDER TYPE: ${payload.orderType}`,
    `CAPTURED: ${payload.capturedAt}`,
  ];

  if (payload.tableIds.length > 0) lines.push(`TABLES: ${payload.tableIds.join(', ')}`);
  if (payload.kind === 'STATION_TICKET') {
    lines.push(`ROUND: ${payload.roundNumber} (${payload.roundId})`);
    lines.push(`STATION: ${payload.stationName} (${payload.stationId})`);
  }

  lines.push('', 'ITEMS');
  for (const item of payload.items) {
    lines.push(`${item.quantity} x ${item.productName}  ${money(item.lineTotal)}`);
    for (const modifier of item.modifiers) {
      lines.push(`  + ${modifier.name}  ${money(modifier.priceDelta)}`);
    }
    if (item.specialInstructions) lines.push(`  NOTE: ${item.specialInstructions}`);
  }

  if (payload.kind !== 'STATION_TICKET') {
    lines.push('', `SUBTOTAL: ${money(payload.subtotal)}`);
    lines.push(`PAID: ${money(payload.paidAmount)}`);
    lines.push(`BALANCE: ${money(payload.balanceDue)}`);
    lines.push(`TIPS: ${money(payload.tipTotal)}`);
  }

  if (payload.kind === 'CUSTOMER_RECEIPT') {
    lines.push('', 'PAYMENTS');
    for (const payment of payload.payments) {
      lines.push(
        `${payment.method}: ${money(payment.amountApplied)} + TIP ${money(payment.tipAmount)}`,
      );
      if (payment.cashTendered) lines.push(`  TENDERED: ${money(payment.cashTendered)}`);
      if (payment.changeGiven.amount > 0) lines.push(`  CHANGE: ${money(payment.changeGiven)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
