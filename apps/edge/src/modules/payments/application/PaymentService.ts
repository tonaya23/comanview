import { CashRepository, OrderRepository } from '@comanview/database';
import { calculateTip, EntityId } from '@comanview/domain';
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

export class PaymentService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly cashRepo: CashRepository,
    private readonly context: EdgeOperationalContext,
  ) {}

  getConfig(): PaymentConfigResponse {
    return {
      tipsEnabled: this.context.tipsEnabled,
      percentageOptionsBasisPoints: this.context.tipPercentageOptionsBasisPoints,
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
      const requestedTip = calculateTip(requestedAmount, request.tip, this.context.tipsEnabled, {
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
    const tipAmount = calculateTip(amountApplied, request.tip, this.context.tipsEnabled, {
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
    return mapOrderToResponse(order);
  }

  voidPayment(
    orderId: string,
    paymentId: string,
    request: VoidPaymentRequest,
    operation: AuthorizedOperation,
  ): OrderResponse {
    void operation;
    const order = this.orderRepo.getOrderById(EntityId.fromString(orderId));
    if (!order) throw new ObjectNotFoundError(`Order ${orderId} not found`);

    if (this.orderRepo.hasProcessedCommand(request.commandId)) {
      const event = this.orderRepo.getProcessedCommandEvent(request.commandId);
      const payment = order.payments.find((candidate) => candidate.id.toString() === paymentId);
      if (
        event?.aggregateId === orderId &&
        event.eventType === 'PAYMENT_VOIDED' &&
        payment?.status === 'VOIDED'
      ) {
        return mapOrderToResponse(order);
      }
      throw this.commandConflict();
    }
    if (order.version !== request.expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${request.expectedVersion}, but got ${order.version}`,
      );
    }

    order.voidPayment(EntityId.fromString(paymentId), request.commandId);
    this.orderRepo.saveOrder(order, true, request.commandId);
    return mapOrderToResponse(order);
  }

  private commandConflict(): AppError {
    return new AppError(
      'COMMAND_ID_CONFLICT',
      409,
      'commandId was already used for a different operation.',
    );
  }
}
