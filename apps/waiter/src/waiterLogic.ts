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

const messages: Record<string, string> = {
  TABLE_OCCUPIED: 'La mesa acaba de ser ocupada en otro dispositivo. Actualizamos el mapa.',
  TABLE_INACTIVE: 'Esta mesa ya no está activa.',
  STALE_ORDER_VERSION: 'La comanda cambió en otro dispositivo. Se actualizó su estado.',
  PRODUCT_UNAVAILABLE: 'Este producto ya no está disponible.',
  INVALID_MODIFIER_SELECTION: 'Revisa las opciones obligatorias y sus límites.',
  ORDER_ITEM_SENT: 'Un producto enviado ya no puede editarse.',
  NO_DRAFT_ITEMS: 'No hay productos nuevos por enviar.',
  ORDER_EMPTY_CANCEL_NOT_ALLOWED: 'La mesa dejó de estar vacía. Actualizamos la cuenta.',
  PERMISSION_DENIED: 'Tu usuario no tiene permiso para esta acción.',
  EDGE_UNREACHABLE: 'No hay conexión con Edge local. La operación no fue confirmada.',
};

export function waiterError(problem: unknown) {
  return problem instanceof EdgeClientError
    ? (messages[problem.code] ?? problem.message)
    : 'Ocurrió un error inesperado.';
}
