import { getUserGuidance } from '@comanview/ui';
import type {
  OrderResponse,
  ProductModifierGroupResponse,
  ProductResponse,
  RestaurantTableResponse,
} from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';

export function visibleProducts(
  products: ProductResponse[],
  categoryId: string | null,
  query = '',
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('es-MX');
  return products
    .filter(
      (product) =>
        product.active &&
        (normalizedQuery
          ? [product.name, product.sku, product.barcode].some((value) =>
              value?.toLocaleLowerCase('es-MX').includes(normalizedQuery),
            )
          : !categoryId || product.categoryId === categoryId),
    )
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

export function tableStatusLabel(status: RestaurantTableResponse['status']) {
  return {
    FREE: 'LIBRE',
    OPEN: 'ABIERTA',
    READY: 'LISTO',
    PAYMENT_REQUESTED: 'CUENTA SOLICITADA',
  }[status];
}

export function activeModifierGroups(product: ProductResponse) {
  return product.modifierGroups
    .filter((assignment) => assignment.modifierGroup.active)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

export function modifierSelectionError(
  group: ProductModifierGroupResponse,
  selectedIds: readonly string[],
): string | null {
  const groupIds = new Set(group.modifierGroup.options.map((option) => option.id));
  const count = selectedIds.filter((id) => groupIds.has(id)).length;
  if (count < group.modifierGroup.minSelections)
    return `Selecciona al menos ${group.modifierGroup.minSelections}.`;
  if (count > group.modifierGroup.maxSelections)
    return `Selecciona máximo ${group.modifierGroup.maxSelections}.`;
  return null;
}

export function money(amount: number, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(amount / 100);
}

export function emptyTableCancellationBlocker(order: OrderResponse): string | null {
  if (order.status !== 'OPEN' || order.orderType !== 'TABLE') {
    return 'Esta mesa ya no está disponible para cancelación simple.';
  }
  if (order.payments.length > 0) {
    return 'La cuenta tiene pagos registrados y requiere un flujo autorizado.';
  }
  if (order.rounds.length > 0 || order.items.some((item) => item.status === 'SENT')) {
    return 'La mesa ya tiene comandas enviadas y requiere una cancelación autorizada.';
  }
  if (order.items.length > 0) {
    return 'Elimina los productos sin enviar antes de cancelar la mesa.';
  }
  return null;
}

export function waiterError(problem: unknown): string {
  const guidance = getUserGuidance(problem instanceof EdgeClientError ? problem : undefined, {
    action: null,
  });
  return guidance.title + '. ' + guidance.explanation;
}
