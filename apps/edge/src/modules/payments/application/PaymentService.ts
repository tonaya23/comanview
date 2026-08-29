import {
  AuditPersistenceError,
  AuditRepository,
  CashRepository,
  OrderRepository,
  type NewAuditEntry,
} from '@comanview/database';
import { calculateTip, EntityId, type Order } from '@comanview/domain';
import { Money } from '@comanview/money';
import type {
  CreatePaymentRequest,
  OrderResponse,
  PaymentConfigResponse,
  VoidPaymentRequest,
} from '@comanview/contracts';
import { AppError } from '../../../app/errorHandler.js';
import type { AuthorizedOperation } from '../../../app/authContext.js';
import { ConcurrencyError, ObjectNotFoundError } from '../../../app/errors.js';
import type { EdgeOperationalContext } from '../../../app/operationalContext.js';
import { mapOrderToResponse } from '../../orders/application/orderMapper.js';
import type { RealtimeHub } from '../../../infrastructure/realtime/RealtimeHub.js';
import type { EdgeLicenseManager } from '../../licensing/EdgeLicenseManager.js';

export class PaymentService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly cashRepo: CashRepository,
    private readonly auditRepo: AuditRepository,
    private readonly context: EdgeOperationalContext,
    private readonly realtime: RealtimeHub,
    private readonly licensing?: EdgeLicenseManager,
  ) {}

  getConfig(): PaymentConfigResponse {
    const config = this.licensing?.currentConfiguration().payment;
    return {
      tipsEnabled: config?.tipsEnabled ?? this.context.tipsEnabled,
      percentageOptionsBasisPoints: config?.tipPercentageOptionsBasisPoints ?? this.context.tipPercentageOptionsBasisPoints,
    };
  }

  createPayment(
    orderId: string,
    request: CreatePaymentRequest,
    operation: AuthorizedOperation,
  ): OrderResponse {
    void operation;
    const previousOrderId = this.orderRepo.getOrderIdByPaymentCommand(request.commandId);
    if (previousOrderId) {
      if (previousOrderId.toString() !== orderId) {
        throw this.commandConflict();
      }
      const previousOrder = this.orderRepo.getOrderById(previousOrderId)!;
      const previousPayment = previousOrder.payments.find(
        (payment) => payment.commandId === request.commandId,
      )!;
      const requestedAmount = Money.fromMinorUnits(request.amountApplied, previousOrder.currency);
      const requestedCashTendered =
        request.cashTendered === undefined || request.cashTendered === null
          ? null
          : Money.fromMinorUnits(request.cashTendered, previousOrder.currency);
      const requestedTip = calculateTip(requestedAmount, request.tip,
        this.licensing?.currentConfiguration().payment.tipsEnabled ?? this.context.tipsEnabled, {
        method: request.method,
        cashTendered: requestedCashTendered,
        // A persisted REMAINDER Payment proves that this amount settled the balance at creation.
        authoritativeBalanceDue: previousPayment.amountApplied,
      });
      if (
        previousPayment.method !== request.method ||
        previousPayment.amountApplied.amount !== request.amountApplied ||
        previousPayment.tipAmount.amount !== requestedTip.amount ||
        (previousPayment.cashTendered?.amount ?? null) !== (request.cashTendered ?? null) ||
        previousPayment.externalReference !== (request.externalReference?.trim() || null)
      ) {
        throw this.commandConflict();
      }
      return mapOrderToResponse(previousOrder);
    }

    if (this.orderRepo.hasProcessedCommand(request.commandId)) throw this.commandConflict();

    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);
    this.licensing?.assertAllowed('PAYMENT_CREATE', 'CORE_POS', orderId);
    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    const session = this.cashRepo.getOpenSession(EntityId.fromString(this.context.cashRegisterId));
    if (!session) {
      throw new AppError(
        'CASH_SESSION_NOT_OPEN',
        409,
        'Abre una sesión de caja antes de registrar pagos desde POS.',
      );
    }
    if (!session.locationId.equals(order.locationId)) {
      throw new AppError(
        'CASH_SESSION_NOT_OPEN',
        409,
        'La sesión de caja abierta no pertenece al Location de la Order.',
      );
    }
    if (session.openingFloat.currency !== order.currency) {
      throw new AppError(
        'PAYMENT_CURRENCY_MISMATCH',
        409,
        'La moneda de la caja no coincide con la moneda de la Order.',
      );
    }

    const amountApplied = Money.fromMinorUnits(request.amountApplied, order.currency);
    const cashTendered =
      request.cashTendered === undefined || request.cashTendered === null
        ? null
        : Money.fromMinorUnits(request.cashTendered, order.currency);
    const tipAmount = calculateTip(amountApplied, request.tip,
      this.licensing?.currentConfiguration().payment.tipsEnabled ?? this.context.tipsEnabled, {
      method: request.method,
      cashTendered,
      authoritativeBalanceDue: order.getBalanceDue(),
    });
    order.completePayment({
      cashSessionId: session.id,
      method: request.method,
      amountApplied,
      tipAmount,
      cashTendered,
      externalReference: request.externalReference ?? null,
      commandId: request.commandId,
    });

    this.orderRepo.saveOrder(order, true, request.commandId);
    this.notifyOrder(order, 'PAYMENT_COMPLETED');
    return mapOrderToResponse(order);
  }

  voidPayment(
    orderId: string,
    paymentId: string,
    request: VoidPaymentRequest,
    operation: AuthorizedOperation,
  ): OrderResponse {
    const reason = request.reason?.trim();
    if (!reason) throw new AppError('REASON_REQUIRED', 400, 'A reason is required.');
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      const payment = order.payments.find((candidate) => candidate.id.toString() === paymentId);
      const audit = this.auditRepo.getByCommand(request.commandId, 'PAYMENT_VOIDED');
      if (
        event?.aggregateId === orderId &&
        event.eventType === 'PAYMENT_VOIDED' &&
        payment?.status === 'VOIDED' &&
        audit?.entityId === paymentId &&
        audit.reason === reason &&
        audit.actorUserId === operation.actor.userId &&
        audit.authorizedByUserId === (operation.authorizedBy?.userId ?? null)
      ) {
        return mapOrderToResponse(order);
      }
      throw this.commandConflict();
    }
    this.licensing?.assertAllowed('PAYMENT_VOID', 'CORE_POS');
    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    const payment = order.payments.find((candidate) => candidate.id.toString() === paymentId);
    if (!payment) throw new ObjectNotFoundError(`Payment ${paymentId} not found`);
    const before = { status: payment.status };
    order.voidPayment(EntityId.fromString(paymentId), request.commandId);
    const event = order.events.find(
      (candidate) =>
        candidate.eventType === 'PAYMENT_VOIDED' &&
        'commandId' in candidate &&
        candidate.commandId === request.commandId,
    );
    const audit: NewAuditEntry = {
      auditId: EntityId.generate().toString(),
      occurredAt: operation.requestedAt,
      tenantId: operation.actor.tenantId,
      locationId: operation.actor.locationId,
      deviceId: operation.actor.deviceId,
      sessionId: operation.actor.sessionId,
      actorUserId: operation.actor.userId,
      actorRole: operation.actor.roles[0] ?? null,
      authorizedByUserId: operation.authorizedBy?.userId ?? null,
      authorizedByRole: operation.authorizedBy?.roles[0] ?? null,
      action: 'PAYMENT_VOIDED',
      entityType: 'PAYMENT',
      entityId: paymentId,
      outcome: 'SUCCESS',
      reason,
      commandId: request.commandId,
      before,
      after: { status: 'VOIDED' },
      amountAffected: payment.amountApplied.amount,
      currency: payment.amountApplied.currency,
      eventId: event?.eventId.toString() ?? null,
    };
    try {
      this.orderRepo.saveOrder(order, true, request.commandId, [], [audit]);
    } catch (error) {
      if (error instanceof AuditPersistenceError) {
        throw new AppError(
          'AUDIT_PERSISTENCE_FAILED',
          500,
          'The required audit record could not be persisted.',
        );
      }
      throw error;
    }
    this.notifyOrder(order, 'PAYMENT_VOIDED');
    return mapOrderToResponse(order);
  }

  private notifyOrder(order: Order, reason: 'PAYMENT_COMPLETED' | 'PAYMENT_VOIDED'): void {
    this.realtime.publish({
      type: 'ORDER_UPDATED',
      locationId: order.locationId.toString(),
      orderId: order.id.toString(),
      version: order.version,
      reason,
      occurredAt: new Date().toISOString(),
    });
    if (order.orderType === 'TABLE') {
      this.realtime.publish({
        type: 'TABLES_CHANGED',
        locationId: order.locationId.toString(),
        tableIds: order.tableIds.map((tableId) => tableId.toString()),
        orderId: order.id.toString(),
        reason: 'ORDER_UPDATED',
        occurredAt: new Date().toISOString(),
      });
    }
  }

  private commandConflict(): AppError {
    return new AppError(
      'COMMAND_ID_CONFLICT',
      409,
      'commandId was already used for a different operation.',
    );
  }
}
