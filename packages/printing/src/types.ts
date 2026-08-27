export const PRINT_JOB_TYPES = ['STATION_TICKET', 'PRECHECK', 'CUSTOMER_RECEIPT'] as const;
export type PrintJobType = (typeof PRINT_JOB_TYPES)[number];

export const PRINT_JOB_STATUSES = [
  'PENDING',
  'SENDING',
  'DELIVERED',
  'CONFIRMED',
  'FAILED',
  'UNKNOWN',
  'CANCELLED',
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export type PrintTargetAdapterType = 'DEBUG' | 'TCP_ESC_POS' | 'USB_ESC_POS';

export interface PrintMoneySnapshot {
  amount: number;
  currency: string;
}

export interface PrintModifierSnapshot {
  modifierOptionId: string;
  name: string;
  priceDelta: PrintMoneySnapshot;
}

export interface PrintItemSnapshot {
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: PrintMoneySnapshot;
  lineTotal: PrintMoneySnapshot;
  modifiers: PrintModifierSnapshot[];
  specialInstructions: string | null;
  stationId: string | null;
  stationName: string | null;
}

export interface PrintPaymentSnapshot {
  paymentId: string;
  method: 'CASH' | 'CARD' | 'OTHER';
  amountApplied: PrintMoneySnapshot;
  tipAmount: PrintMoneySnapshot;
  chargedTotal: PrintMoneySnapshot;
  cashTendered: PrintMoneySnapshot | null;
  changeGiven: PrintMoneySnapshot;
  completedAt: string | null;
}

interface BasePrintPayload {
  orderId: string;
  orderNumber: string;
  orderType: 'COUNTER' | 'TABLE' | 'TAKEOUT';
  tableIds: string[];
  capturedAt: string;
  items: PrintItemSnapshot[];
}

export interface StationTicketPayload extends BasePrintPayload {
  kind: 'STATION_TICKET';
  roundId: string;
  roundNumber: number;
  roundSentAt: string;
  stationId: string;
  stationName: string;
}

export interface PrecheckPayload extends BasePrintPayload {
  kind: 'PRECHECK';
  subtotal: PrintMoneySnapshot;
  paidAmount: PrintMoneySnapshot;
  balanceDue: PrintMoneySnapshot;
  tipTotal: PrintMoneySnapshot;
}

export interface CustomerReceiptPayload extends BasePrintPayload {
  kind: 'CUSTOMER_RECEIPT';
  subtotal: PrintMoneySnapshot;
  paidAmount: PrintMoneySnapshot;
  balanceDue: PrintMoneySnapshot;
  tipTotal: PrintMoneySnapshot;
  payments: PrintPaymentSnapshot[];
  orderCreatedAt: string;
}

export type PrintJobPayload = StationTicketPayload | PrecheckPayload | CustomerReceiptPayload;

export interface PrintJob {
  printJobId: string;
  tenantId: string;
  locationId: string;
  orderId: string;
  roundId: string | null;
  stationId: string | null;
  targetId: string | null;
  jobType: PrintJobType;
  payload: PrintJobPayload;
  status: PrintJobStatus;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  nextAttemptAt: Date | null;
  lastError: string | null;
  parentJobId: string | null;
  dedupeKey: string;
}

export interface PrintTarget {
  targetId: string;
  tenantId: string;
  locationId: string;
  stationId: string | null;
  name: string;
  adapterType: PrintTargetAdapterType;
  active: boolean;
  configuration: Record<string, unknown>;
}

export interface PrinterAdapterResult {
  outcome: 'DELIVERED' | 'UNKNOWN';
  detail?: string;
}

export interface PrinterAdapter {
  print(job: PrintJob, target: PrintTarget): Promise<PrinterAdapterResult>;
}

export class PrinterAdapterError extends Error {
  constructor(
    message: string,
    readonly transmission: 'NOT_STARTED' | 'UNKNOWN',
  ) {
    super(message);
    this.name = 'PrinterAdapterError';
  }
}

export interface PrintQueue {
  recoverInterruptedJobs(): number;
  claimNext(now: Date): { job: PrintJob; target: PrintTarget | null } | null;
  markDelivered(printJobId: string, detail?: string): void;
  markFailed(printJobId: string, error: string, nextAttemptAt: Date | null): void;
  markUnknown(printJobId: string, error: string): void;
}
