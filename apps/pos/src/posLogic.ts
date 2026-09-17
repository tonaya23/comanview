import type {
  CategoryResponse,
  ProductModifierGroupResponse,
  ProductResponse,
  RestaurantTableResponse,
} from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';
import { getUserGuidance } from '@comanview/ui';

export const ALL_CATEGORIES = 'ALL';

export interface OpenTableAccount {
  orderId: string;
  orderNumber: string;
  tableNames: string[];
  status: Exclude<RestaurantTableResponse['status'], 'FREE'>;
  total: RestaurantTableResponse['total'];
  balanceDue: RestaurantTableResponse['balanceDue'];
  draftItemCount: number;
  preparingItemCount: number;
  readyItemCount: number;
  createdAt: string | null;
}

export function getOpenTableAccounts(tables: RestaurantTableResponse[]): OpenTableAccount[] {
  const accounts = new Map<string, OpenTableAccount>();
  for (const table of tables) {
    if (table.status === 'FREE' || !table.activeOrderId || !table.activeOrderNumber) continue;
    const existing = accounts.get(table.activeOrderId);
    if (existing) {
      existing.tableNames.push(table.name);
    } else {
      accounts.set(table.activeOrderId, {
        orderId: table.activeOrderId,
        orderNumber: table.activeOrderNumber,
        tableNames: [table.name],
        status: table.status,
        total: table.total,
        balanceDue: table.balanceDue,
        draftItemCount: table.draftItemCount,
        preparingItemCount: table.preparingItemCount,
        readyItemCount: table.readyItemCount,
        createdAt: table.activeOrderCreatedAt,
      });
    }
  }
  const priority = { PAYMENT_REQUESTED: 0, READY: 1, OPEN: 2 } as const;
  return [...accounts.values()].sort(
    (left, right) =>
      priority[left.status] - priority[right.status] ||
      (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
      left.orderNumber.localeCompare(right.orderNumber),
  );
}

export function getTableStatusLabel(status: RestaurantTableResponse['status']): string {
  return {
    FREE: 'LIBRE',
    OPEN: 'ABIERTA',
    READY: 'LISTO',
    PAYMENT_REQUESTED: 'CUENTA SOLICITADA',
  }[status];
}

export function getVisibleProducts(
  products: ProductResponse[],
  selectedCategoryId: string,
  query = '',
): ProductResponse[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('es-MX');
  return products
    .filter(
      (product) =>
        product.active &&
        (normalizedQuery
          ? [product.name, product.sku, product.barcode].some((value) =>
              value?.toLocaleLowerCase('es-MX').includes(normalizedQuery),
            )
          : selectedCategoryId === ALL_CATEGORIES || product.categoryId === selectedCategoryId),
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

export function getCashDifferencePresentation(amount: number, currency: string) {
  if (amount < 0) {
    return { label: 'Faltante', value: formatMoney(amount, currency), tone: 'shortage' as const };
  }
  if (amount > 0) {
    return {
      label: 'Sobrante',
      value: `+${formatMoney(amount, currency)}`,
      tone: 'surplus' as const,
    };
  }
  return { label: 'Caja cuadrada', value: formatMoney(0, currency), tone: 'balanced' as const };
}



export function canEditDraftItem(status: 'DRAFT' | 'SENT'): boolean {
  return status === 'DRAFT';
}

export function canCreateAnotherCounterOrder(
  order: Pick<import('@comanview/contracts').OrderResponse, 'status' | 'items'> | null,
): boolean {
  return !(order?.status === 'OPEN' && order.items.length === 0);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof EdgeClientError) {
    return getUserGuidance(error).explanation;
  }

  return getUserGuidance('UNKNOWN_EDGE_ERROR').explanation;
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
