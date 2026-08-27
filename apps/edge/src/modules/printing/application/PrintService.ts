import type { Order, Round } from '@comanview/domain';
import { EntityId } from '@comanview/domain';
import { PrintJobRepository, type NewPrintJob, type OrderRepository } from '@comanview/database';
import type { PrintJob, PrintItemSnapshot } from '@comanview/printing';
import type { PrintJobResponse, RequestPrintJob } from '@comanview/contracts';
import { ObjectNotFoundError } from '../../../app/errors.js';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';

export function mapPrintJob(job: PrintJob): PrintJobResponse {
  return {
    printJobId: job.printJobId,
    orderId: job.orderId,
    roundId: job.roundId,
    stationId: job.stationId,
    targetId: job.targetId,
    jobType: job.jobType,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    lastError: job.lastError,
  };
}

export class PrintService {
  constructor(
    private readonly printRepo: PrintJobRepository,
    private readonly orderRepo: OrderRepository,
  ) {}

  createStationJobs(order: Order, round: Round): NewPrintJob[] {
    const stationGroups = new Map<string, typeof order.items>();
    for (const item of order.items) {
      if (!item.roundId?.equals(round.id) || !item.snapshot.stationId) continue;
      const stationId = item.snapshot.stationId.toString();
      stationGroups.set(stationId, [...(stationGroups.get(stationId) ?? []), item]);
    }

    const jobs: NewPrintJob[] = [];
    for (const [stationId, items] of stationGroups) {
      const station = this.printRepo.getStation(stationId);
      const target = this.printRepo.getTargetForStation(stationId);
      const stationName = station?.name ?? `STATION ${stationId}`;
      const createdAt = new Date();
      jobs.push({
        printJobId: EntityId.generate().toString(),
        tenantId: order.tenantId.toString(),
        locationId: order.locationId.toString(),
        orderId: order.id.toString(),
        roundId: round.id.toString(),
        stationId,
        targetId: target?.targetId ?? null,
        jobType: 'STATION_TICKET',
        payload: {
          kind: 'STATION_TICKET',
          ...this.basePayload(order, createdAt, items, stationName),
          roundId: round.id.toString(),
          roundNumber: round.roundNumber,
          roundSentAt: round.sentAt.toISOString(),
          stationId,
          stationName,
        },
        createdAt,
        parentJobId: null,
        dedupeKey: `round:${round.id.toString()}:station:${stationId}`,
      });
    }
    return jobs;
  }

  requestPrecheck(
    orderId: string,
    request: RequestPrintJob,
    operation: AuthorizedOperation,
  ): PrintJobResponse {
    void operation;
    const existing = this.printRepo.getByDedupeKey(`precheck:${request.commandId}`);
    if (existing) return mapPrintJob(existing);
    if (this.orderRepo.hasProcessedCommand(request.commandId)) throw this.commandConflict();
    const order = this.requireOrder(orderId);
    if (order.status !== 'OPEN') {
      throw new AppError(
        'PRECHECK_REQUIRES_OPEN_ORDER',
        409,
        'La precuenta requiere una Order OPEN.',
      );
    }
    const createdAt = new Date();
    const target = this.printRepo.getDefaultTarget();
    const job: NewPrintJob = {
      printJobId: EntityId.generate().toString(),
      tenantId: order.tenantId.toString(),
      locationId: order.locationId.toString(),
      orderId,
      roundId: null,
      stationId: null,
      targetId: target?.targetId ?? null,
      jobType: 'PRECHECK',
      createdAt,
      parentJobId: null,
      dedupeKey: `precheck:${request.commandId}`,
      payload: {
        kind: 'PRECHECK',
        ...this.basePayload(order, createdAt, order.items, null),
        subtotal: order.getSubtotal().toJSON(),
        paidAmount: order.getPaidAmount().toJSON(),
        balanceDue: order.getBalanceDue().toJSON(),
        tipTotal: order.getTipTotal().toJSON(),
      },
    };
    this.printRepo.enqueue([job], request.commandId);
    return mapPrintJob(this.printRepo.getByDedupeKey(job.dedupeKey)!);
  }

  requestCustomerReceipt(
    orderId: string,
    request: RequestPrintJob,
    operation: AuthorizedOperation,
  ): PrintJobResponse {
    void operation;
    const existing = this.printRepo.getByDedupeKey(`receipt:${request.commandId}`);
    if (existing) return mapPrintJob(existing);
    if (this.orderRepo.hasProcessedCommand(request.commandId)) throw this.commandConflict();
    const order = this.requireOrder(orderId);
    if (order.status !== 'CLOSED') {
      throw new AppError(
        'RECEIPT_REQUIRES_CLOSED_ORDER',
        409,
        'El recibo requiere una Order CLOSED.',
      );
    }
    const createdAt = new Date();
    const target = this.printRepo.getDefaultTarget();
    const job: NewPrintJob = {
      printJobId: EntityId.generate().toString(),
      tenantId: order.tenantId.toString(),
      locationId: order.locationId.toString(),
      orderId,
      roundId: null,
      stationId: null,
      targetId: target?.targetId ?? null,
      jobType: 'CUSTOMER_RECEIPT',
      createdAt,
      parentJobId: null,
      dedupeKey: `receipt:${request.commandId}`,
      payload: {
        kind: 'CUSTOMER_RECEIPT',
        ...this.basePayload(order, createdAt, order.items, null),
        subtotal: order.getSubtotal().toJSON(),
        paidAmount: order.getPaidAmount().toJSON(),
        balanceDue: order.getBalanceDue().toJSON(),
        tipTotal: order.getTipTotal().toJSON(),
        orderCreatedAt: order.createdAt.toISOString(),
        payments: order.payments
          .filter((payment) => payment.status === 'COMPLETED')
          .map((payment) => ({
            paymentId: payment.id.toString(),
            method: payment.method,
            amountApplied: payment.amountApplied.toJSON(),
            tipAmount: payment.tipAmount.toJSON(),
            chargedTotal: payment.chargedTotal.toJSON(),
            cashTendered: payment.cashTendered?.toJSON() ?? null,
            changeGiven: payment.changeGiven.toJSON(),
            completedAt: payment.completedAt?.toISOString() ?? null,
          })),
      },
    };
    this.printRepo.enqueue([job], request.commandId);
    return mapPrintJob(this.printRepo.getByDedupeKey(job.dedupeKey)!);
  }

  listRecent(): PrintJobResponse[] {
    return this.printRepo.listRecent().map(mapPrintJob);
  }

  private requireOrder(orderId: string): Order {
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);
    return order;
  }

  private basePayload(
    order: Order,
    capturedAt: Date,
    items: typeof order.items,
    stationName: string | null,
  ) {
    return {
      orderId: order.id.toString(),
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableIds: order.tableIds.map((id) => id.toString()),
      capturedAt: capturedAt.toISOString(),
      items: items.map((item): PrintItemSnapshot => {
        const modifierAmount = item.snapshot.modifiers.reduce(
          (sum, modifier) => sum + modifier.priceDelta.amount,
          0,
        );
        return {
          orderItemId: item.id.toString(),
          productId: item.snapshot.productId.toString(),
          productName: item.snapshot.productName,
          quantity: item.quantity,
          unitPrice: {
            amount: item.snapshot.basePrice.amount + modifierAmount,
            currency: order.currency,
          },
          lineTotal: item.getLineTotal().toJSON(),
          modifiers: item.snapshot.modifiers.map((modifier) => ({
            modifierOptionId: modifier.id.toString(),
            name: modifier.name,
            priceDelta: modifier.priceDelta.toJSON(),
          })),
          specialInstructions: item.specialInstructions,
          stationId: item.snapshot.stationId?.toString() ?? null,
          stationName,
        };
      }),
    };
  }

  private commandConflict() {
    return new AppError(
      'COMMAND_ID_CONFLICT',
      409,
      'commandId was already used for a different operation.',
    );
  }
}
