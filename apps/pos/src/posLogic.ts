import type {
  CategoryResponse,
  ProductModifierGroupResponse,
  ProductResponse,
} from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';

export const ALL_CATEGORIES = 'ALL';

export function getVisibleProducts(
  products: ProductResponse[],
  selectedCategoryId: string,
): ProductResponse[] {
  return products
    .filter(
      (product) =>
        product.active &&
        (selectedCategoryId === ALL_CATEGORIES || product.categoryId === selectedCategoryId),
    )
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder || left.name.localeCompare(right.name),
    );
}

export function getVisibleCategories(categories: CategoryResponse[]): CategoryResponse[] {
  return categories
    .filter((category) => category.active)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getActiveModifierGroups(product: ProductResponse): ProductModifierGroupResponse[] {
  return product.modifierGroups
    .filter(({ modifierGroup }) => modifierGroup.active)
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.modifierGroup.name.localeCompare(right.modifierGroup.name),
    );
}

export function getEffectiveModifierPrice(
  group: ProductModifierGroupResponse,
  modifierOptionId: string,
): number {
  const option = group.modifierGroup.options.find(({ id }) => id === modifierOptionId);
  return (
    group.priceDeltaOverrides[modifierOptionId]?.amount ?? option?.defaultPriceDelta.amount ?? 0
  );
}

export function getConfiguredProductTotal(
  product: ProductResponse,
  selectedModifierIds: string[],
): number {
  return getActiveModifierGroups(product).reduce(
    (total, group) =>
      total +
      selectedModifierIds.reduce(
        (groupTotal, optionId) => groupTotal + getEffectiveModifierPrice(group, optionId),
        0,
      ),
    product.basePrice.amount,
  );
}

export function getUnsatisfiedModifierGroups(
  product: ProductResponse,
  selectedModifierIds: string[],
): ProductModifierGroupResponse[] {
  return getActiveModifierGroups(product).filter(({ modifierGroup }) => {
    const optionIds = new Set(modifierGroup.options.map(({ id }) => id));
    const selectedCount = selectedModifierIds.filter((id) => optionIds.has(id)).length;
    return (
      selectedCount < modifierGroup.minSelections || selectedCount > modifierGroup.maxSelections
    );
  });
}

export function getModifierGroupValidationMessage(
  group: ProductModifierGroupResponse,
  selectedModifierIds: string[],
): string | null {
  const optionIds = new Set(group.modifierGroup.options.map(({ id }) => id));
  const selectedCount = selectedModifierIds.filter((id) => optionIds.has(id)).length;
  if (selectedCount < group.modifierGroup.minSelections) {
    return group.modifierGroup.minSelections === 1
      ? `Selecciona 1 opción en ${group.modifierGroup.name}.`
      : `Selecciona al menos ${group.modifierGroup.minSelections} opciones en ${group.modifierGroup.name}.`;
  }
  if (selectedCount > group.modifierGroup.maxSelections) {
    return `Selecciona máximo ${group.modifierGroup.maxSelections} opciones en ${group.modifierGroup.name}.`;
  }
  return null;
}

export function getSnapshotTotal(snapshot: {
  basePrice: { amount: number };
  selectedModifiers: Array<{ priceDelta: { amount: number } }>;
}): number {
  return snapshot.selectedModifiers.reduce(
    (total, modifier) => total + modifier.priceDelta.amount,
    snapshot.basePrice.amount,
  );
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

const errorMessages: Record<string, string> = {
  PRECHECK_REQUIRES_OPEN_ORDER:
    'La precuenta solo está disponible mientras la venta sigue abierta.',
  RECEIPT_REQUIRES_CLOSED_ORDER: 'Cierra la venta antes de generar el recibo.',
  EDGE_UNREACHABLE: 'Se perdió la conexión local con Edge. La operación no está confirmada.',
  PRODUCT_UNAVAILABLE:
    'Este producto ya no está disponible. Actualiza el catálogo e intenta de nuevo.',
  PRODUCT_INACTIVE: 'Este producto fue retirado del catálogo.',
  INVALID_MODIFIER_SELECTION: 'Revisa las opciones obligatorias y los límites de selección.',
  MODIFIER_UNAVAILABLE:
    'Una opción seleccionada ya no está disponible. Actualizamos el catálogo; revisa tu selección.',
  MODIFIER_INACTIVE:
    'Una opción seleccionada fue retirada del catálogo. Actualizamos el catálogo; revisa tu selección.',
  ORDER_ITEM_SENT: 'El producto ya fue enviado y no puede eliminarse como borrador.',
  ORDER_PAID_AMOUNT_EXCEEDS_TOTAL:
    'La edición dejaría el total por debajo de lo ya pagado. Conserva o aumenta el importe.',
  ORDER_ITEM_SPECIAL_INSTRUCTIONS_FROZEN:
    'La nota quedó protegida porque el producto ya fue enviado.',
  SPECIAL_INSTRUCTIONS_TOO_LONG: 'La nota especial no puede superar 500 caracteres.',
  NO_DRAFT_ITEMS: 'No hay productos nuevos por enviar.',
  STALE_ORDER_VERSION:
    'La venta cambió en otro dispositivo. Se actualizó su estado; revisa e intenta de nuevo.',
  ORDER_NOT_FOUND: 'La venta actual ya no está disponible en Edge.',
  CASH_SESSION_NOT_OPEN: 'Abre la caja antes de registrar un pago.',
  CASH_SESSION_ALREADY_OPEN: 'Esta caja ya tiene una sesión abierta.',
  PAYMENT_OVERPAYMENT: 'El pago supera el saldo pendiente de la venta.',
  INVALID_CASH_TENDERED: 'El efectivo recibido no cubre consumo y propina.',
  INVALID_PAYMENT_AMOUNT: 'Ingresa un monto de pago válido.',
  INVALID_TIP: 'La propina indicada no es válida.',
  TIPS_DISABLED: 'Las propinas están desactivadas en esta ubicación.',
  ORDER_BALANCE_NOT_ZERO: 'La venta todavía tiene saldo pendiente y no puede cerrarse.',
  ORDER_HAS_DRAFT_ITEMS: 'Envía o elimina los productos pendientes antes de cerrar la venta.',
  PAYMENT_CURRENCY_MISMATCH: 'La moneda del pago no coincide con la venta.',
  COMMAND_ID_CONFLICT: 'La operación ya fue utilizada con datos diferentes. Intenta nuevamente.',
  INVALID_EDGE_RESPONSE: 'Edge respondió con datos inesperados. Intenta recargar la pantalla.',
};

export function canEditDraftItem(status: 'DRAFT' | 'SENT'): boolean {
  return status === 'DRAFT';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof EdgeClientError) {
    return errorMessages[error.code] ?? error.message;
  }

  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

export function parseMoneyInputToMinorUnits(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) return null;
  const major = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const amount = major * 100n + BigInt(fraction || '0');
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

export function minorUnitsToInput(amount: number): string {
  const major = Math.floor(amount / 100);
  const fraction = String(amount % 100).padStart(2, '0');
  return `${major}.${fraction}`;
}

export function percentageAmountHalfUp(amount: number, basisPoints: number): number {
  const numerator = BigInt(amount) * BigInt(basisPoints);
  return Number((numerator + 5_000n) / 10_000n);
}

export function getLocalBusinessDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
