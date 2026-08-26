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
  INVALID_EDGE_RESPONSE: 'Edge respondió con datos inesperados. Intenta recargar la pantalla.',
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof EdgeClientError) {
    return errorMessages[error.code] ?? error.message;
  }

  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}
