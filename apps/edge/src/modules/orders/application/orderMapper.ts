import type { OrderResponse } from '@comanview/contracts';
import type { Order } from '@comanview/domain';

export function mapOrderToResponse(order: Order): OrderResponse {
  const subtotal = order.getSubtotal();
  const paidAmount = order.getPaidAmount();
  const balanceDue = order.getBalanceDue();
  const tipTotal = order.getTipTotal();

  return {
    id: order.id.toString(),
    tenantId: order.tenantId.toString(),
    locationId: order.locationId.toString(),
    orderType: order.orderType,
    channel: order.orderChannel,
    currency: order.currency,
    status: order.status,
    tableIds: order.tableIds.map((tableId) => tableId.toString()),
    items: order.items.map((item) => ({
      id: item.id.toString(),
      status: item.sendStatus,
      addedAt: order.createdAt.toISOString(),
      sentAt: item.isSent ? order.createdAt.toISOString() : null,
      productSnapshot: {
        productId: item.snapshot.productId.toString(),
        productName: item.snapshot.productName,
        basePrice: item.snapshot.basePrice.toJSON(),
        taxRateBasisPoints: item.snapshot.taxRateBasisPoints,
        taxCalculationMode: item.snapshot.taxCalculationMode,
        stationId: item.snapshot.stationId?.toString() ?? null,
        selectedModifiers: item.snapshot.modifiers.map((modifier) => ({
          modifierOptionId: modifier.id.toString(),
          name: modifier.name,
          priceDelta: modifier.priceDelta.toJSON(),
        })),
      },
    })),
    rounds: order.rounds.map((round) => ({
      id: round.id.toString(),
      roundNumber: round.roundNumber,
      sentAt: round.sentAt.toISOString(),
      itemIds: order.items
        .filter((item) => item.roundId?.equals(round.id))
        .map((item) => item.id.toString()),
    })),
    subtotal: subtotal.toJSON(),
    total: subtotal.toJSON(),
    paidAmount: paidAmount.toJSON(),
    balanceDue: balanceDue.toJSON(),
    tipTotal: tipTotal.toJSON(),
    payments: order.payments.map((payment) => ({
      id: payment.id.toString(),
      orderId: payment.orderId.toString(),
      cashSessionId: payment.cashSessionId.toString(),
      method: payment.method,
      amountApplied: payment.amountApplied.toJSON(),
      tipAmount: payment.tipAmount.toJSON(),
      chargedTotal: payment.chargedTotal.toJSON(),
      cashTendered: payment.cashTendered?.toJSON() ?? null,
      changeGiven: payment.changeGiven.toJSON(),
      status: payment.status,
      externalReference: payment.externalReference,
      commandId: payment.commandId,
      createdAt: payment.createdAt.toISOString(),
      completedAt: payment.completedAt?.toISOString() ?? null,
      voidedAt: payment.voidedAt?.toISOString() ?? null,
    })),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.createdAt.toISOString(),
  };
}
