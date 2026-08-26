import type { CategoryResponse, ProductResponse } from '@comanview/contracts';
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

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

const errorMessages: Record<string, string> = {
  EDGE_UNREACHABLE: 'Se perdió la conexión local con Edge. La operación no está confirmada.',
  PRODUCT_UNAVAILABLE:
    'Este producto ya no está disponible. Actualiza el catálogo e intenta de nuevo.',
  PRODUCT_INACTIVE: 'Este producto fue retirado del catálogo.',
  ORDER_ITEM_SENT: 'El producto ya fue enviado y no puede eliminarse como borrador.',
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
