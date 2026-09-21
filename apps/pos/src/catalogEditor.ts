import type { EdgeClient } from '@comanview/client-sdk';
import type {
  CatalogCommandInput,
  CatalogCommandResult,
  ProductResponse,
  CategoryResponse,
  TaxAdministrationState,
  RestaurantAdministrationState,
} from '@comanview/contracts';
import { parseMoneyInputToMinorUnits } from './posLogic.js';

export type ProductDraft = {
  name: string;
  description: string;
  sku: string;
  barcode: string;
  categoryId: string;
  price: string;
  taxId: string;
  stationId: string;
  active: boolean;
  available: boolean;
  displayOrder: string;
  reason: string;
};
export function productDraft(p: ProductResponse): ProductDraft {
  return {
    name: p.name,
    description: p.description,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    categoryId: p.categoryId ?? '',
    price: minorDecimal(p.basePrice.amount),
    taxId: p.taxProfile.id,
    stationId: p.stationId ?? '',
    active: p.active,
    available: p.available,
    displayOrder: String(p.displayOrder),
    reason: '',
  };
}
export function minorDecimal(amount: number) {
  const n = BigInt(amount);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
/** Explicit rebase preserves only edited fields, never overwriting an unrelated remote change. */
export function rebaseProductDraft(
  base: ProductResponse,
  draft: ProductDraft,
  latest: ProductResponse,
): ProductDraft {
  const original = productDraft(base),
    fresh = productDraft(latest);
  const value = <K extends keyof ProductDraft>(key: K): ProductDraft[K] =>
    draft[key] !== original[key] ? draft[key] : fresh[key];
  return {
    name: value('name'),
    description: value('description'),
    sku: value('sku'),
    barcode: value('barcode'),
    categoryId: value('categoryId'),
    price: value('price'),
    taxId: value('taxId'),
    stationId: value('stationId'),
    active: value('active'),
    available: value('available'),
    displayOrder: value('displayOrder'),
    reason: draft.reason,
  };
}
export const categoryName = (c: CategoryResponse) =>
  c.systemKey === 'UNCATEGORIZED' ? 'Sin categoría' : c.name;
export function filterProducts(
  products: ProductResponse[],
  query: string,
  category: string,
  active: string,
  available: string,
) {
  const q = query.trim().toLocaleLowerCase();
  return products
    .filter(
      (p) =>
        (!q || [p.name, p.sku, p.barcode].some((v) => v?.toLocaleLowerCase().includes(q))) &&
        (!category || p.categoryId === category) &&
        (!active || String(p.active) === active) &&
        (!available || String(p.available) === available),
    )
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
}
export type References = {
  categories: CategoryResponse[];
  tax: TaxAdministrationState | null;
  admin: RestaurantAdministrationState | null;
};
export function validateDraft(d: ProductDraft) {
  if (!d.name.trim()) throw new Error('Escribe el nombre del producto.');
  if (parseMoneyInputToMinorUnits(d.price) === null)
    throw new Error('Escribe un precio válido, por ejemplo 100.00.');
  if (!/^\d+$/.test(d.displayOrder) || !Number.isSafeInteger(Number(d.displayOrder)))
    throw new Error('El orden debe ser un número entero positivo o cero.');
}
function categoryRef(id: string, refs: References) {
  const c = refs.categories.find((c) => c.id === id);
  if (!c?.version) throw new Error('Consulta las categorías actuales antes de guardar.');
  return { id: c.id, version: c.version };
}
function taxRef(id: string, refs: References) {
  const t = refs.tax?.profiles.find((t) => t.id === id && t.active);
  if (!t) throw new Error('Selecciona un impuesto activo en Configuración de impuestos.');
  return { id: t.id, version: t.version };
}
function stationRef(id: string, refs: References) {
  if (!id) return null;
  const s = refs.admin?.stations.find((s) => s.id === id && s.active);
  if (!s) throw new Error('Selecciona una estación activa.');
  return { id: s.id, version: s.version };
}
export function createProductCommand(
  d: ProductDraft,
  refs: References,
  permissions: readonly string[],
): CatalogCommandInput {
  validateDraft(d);
  const currency = refs.admin?.operational.currency;
  if (!currency) throw new Error('Configura primero la moneda del restaurante.');
  return {
    kind: 'CREATE_PRODUCT',
    commandId: crypto.randomUUID(),
    expectedVersion: 0,
    payload: {
      name: d.name.trim(),
      description: d.description,
      sku: d.sku || null,
      barcode: d.barcode || null,
      category: categoryRef(d.categoryId, refs),
      basePrice: { amount: parseMoneyInputToMinorUnits(d.price)!, currency },
      ...(permissions.includes('TAX_PROFILE_MANAGE') ? { taxProfile: taxRef(d.taxId, refs) } : {}),
      station: permissions.includes('STATION_MANAGE') ? stationRef(d.stationId, refs) : null,
      displayOrder: Number(d.displayOrder),
      active: d.active,
      available: d.available,
    },
  };
}
type Step = { label: string; run(version: number): Promise<number> };
/** Retains the exact command across an uncertain ACK; only acknowledged steps advance version. */
export class ProductSavePlan {
  completed: string[] = [];
  private index = 0;
  private running = false;
  constructor(
    public version: number,
    private steps: Step[],
  ) {}
  get pending() {
    return this.steps.slice(this.index).map((s) => s.label);
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.index < this.steps.length) {
        const step = this.steps[this.index]!;
        this.version = await step.run(this.version);
        this.completed.push(step.label);
        this.index++;
      }
    } finally {
      this.running = false;
    }
  }
}
export function productSavePlan(
  edge: EdgeClient,
  p: ProductResponse,
  d: ProductDraft,
  refs: References,
  permissions: readonly string[],
) {
  validateDraft(d);
  if (!p.version) throw new Error('Actualiza el catálogo antes de editar.');
  const steps: Step[] = [];
  const catalog = (label: string, make: (version: number) => CatalogCommandInput) => {
    let command: CatalogCommandInput | undefined;
    steps.push({
      label,
      run: async (version) => {
        command ??= make(version);
        const result = await edge.catalogCommand(command);
        if (!result.version)
          throw new Error('Respuesta sin versión confirmada. Reintenta el mismo cambio.');
        return result.version;
      },
    });
  };
  const base = () => ({ commandId: crypto.randomUUID(), entityId: p.id });
  if (
    d.name !== p.name ||
    d.description !== p.description ||
    d.sku !== (p.sku ?? '') ||
    d.barcode !== (p.barcode ?? '') ||
    Number(d.displayOrder) !== p.displayOrder
  )
    catalog('Información', (version) => ({
      ...base(),
      kind: 'UPDATE_PRODUCT_DETAILS',
      expectedVersion: version,
      payload: {
        name: d.name.trim(),
        description: d.description,
        sku: d.sku || null,
        barcode: d.barcode || null,
        displayOrder: Number(d.displayOrder),
      },
    }));
  if (d.categoryId !== p.categoryId) {
    const category = categoryRef(d.categoryId, refs);
    catalog('Categoría', (version) => ({
      ...base(),
      kind: 'ASSIGN_PRODUCT_CATEGORY',
      expectedVersion: version,
      payload: { category },
    }));
  }
  const amount = parseMoneyInputToMinorUnits(d.price)!;
  if (amount !== p.basePrice.amount) {
    if (!d.reason.trim()) throw new Error('Explica el motivo del cambio de precio.');
    catalog('Precio', (version) => ({
      ...base(),
      kind: 'UPDATE_PRODUCT_PRICE',
      expectedVersion: version,
      reason: d.reason.trim(),
      payload: { basePrice: { amount, currency: p.basePrice.currency } },
    }));
  }
  if (d.taxId !== p.taxProfile.id) {
    if (!permissions.includes('TAX_PROFILE_MANAGE'))
      throw new Error('Tu rol no puede cambiar impuestos.');
    const ref = taxRef(d.taxId, refs);
    let command: Parameters<EdgeClient['executeTaxAdministration']>[0] | undefined;
    steps.push({
      label: 'Impuesto',
      run: async (version) => {
        command ??= {
          kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
          commandId: crypto.randomUUID(),
          expectedVersion: version,
          productId: p.id,
          profileId: ref.id,
          profileVersion: ref.version,
          reason: 'Edición comercial del producto',
        };
        return (await edge.executeTaxAdministration(command)).version;
      },
    });
  }
  if (d.stationId !== (p.stationId ?? '')) {
    if (!permissions.includes('STATION_MANAGE'))
      throw new Error('Tu rol no puede cambiar estaciones.');
    const ref = stationRef(d.stationId, refs);
    let command: Parameters<EdgeClient['executeRestaurantAdministration']>[0] | undefined;
    steps.push({
      label: 'Estación',
      run: async (version) => {
        command ??= {
          kind: 'ASSIGN_PRODUCT_STATION',
          commandId: crypto.randomUUID(),
          expectedVersion: version,
          productId: p.id,
          stationId: ref?.id ?? null,
          ...(ref ? { stationVersion: ref.version } : {}),
          reason: 'Edición comercial del producto',
        };
        return (await edge.executeRestaurantAdministration(command)).version;
      },
    });
  }
  if (d.available !== p.available)
    catalog('Disponibilidad', (version) => ({
      ...base(),
      kind: 'SET_PRODUCT_AVAILABILITY',
      expectedVersion: version,
      payload: { available: d.available },
    }));
  if (d.active !== p.active)
    catalog('Estado activo', (version) => ({
      ...base(),
      kind: 'SET_PRODUCT_ACTIVE',
      expectedVersion: version,
      payload: { active: d.active },
    }));
  return new ProductSavePlan(p.version, steps);
}
/** One immutable logical attempt, including quick actions and category commands. */
export class CatalogAttempt {
  result: CatalogCommandResult | null = null;
  constructor(readonly command: CatalogCommandInput) {}
  async run(edge: EdgeClient) {
    return (this.result ??= await edge.catalogCommand(this.command));
  }
}
