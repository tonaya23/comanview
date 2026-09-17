import type { EdgeClient } from '@comanview/client-sdk';
import type { TypedNavigationTarget, AdministrationNavigationTarget } from '@comanview/ui';

export type AdminSectionId = AdministrationNavigationTarget['section'];
export const ADMIN_SECTIONS = [
  { id: 'business-profile', label: 'Negocio', group: 'Restaurante' },
  { id: 'day-currency', label: 'Día y moneda', group: 'Restaurante' },
  { id: 'taxes', label: 'Impuestos', group: 'Restaurante' },
  { id: 'tips', label: 'Propinas', group: 'Restaurante' },
  { id: 'registers', label: 'Cajas', group: 'Operación' },
  { id: 'zones-tables', label: 'Zonas y mesas', group: 'Operación' },
  { id: 'stations', label: 'Estaciones', group: 'Operación' },
  { id: 'personnel', label: 'Personal', group: 'Equipo' },
] as const satisfies readonly { id: AdminSectionId; label: string; group: string }[];
export const sectionIndex: Record<AdminSectionId, number> = {
  'business-profile': 0,
  'day-currency': 1,
  registers: 2,
  stations: 3,
  'zones-tables': 4,
  taxes: 5,
  tips: 6,
  personnel: 7,
};
export function canOpenAdminSection(section: AdminSectionId, permissions: readonly string[]) {
  return permissions.includes(section === 'personnel' ? 'PERSONNEL_VIEW' : 'ADMINISTRATION_VIEW');
}
export function resolveAdminTarget(
  target: TypedNavigationTarget | null | undefined,
  permissions: readonly string[],
): AdminSectionId | null {
  return target?.surface === 'administration' && canOpenAdminSection(target.section, permissions)
    ? target.section
    : null;
}

type Resources = {
  admin: Awaited<ReturnType<EdgeClient['getRestaurantAdministration']>>;
  tax: Awaited<ReturnType<EdgeClient['getTaxAdministration']>>;
  people: Awaited<ReturnType<EdgeClient['getPersonnel']>>;
  products: Awaited<ReturnType<EdgeClient['getProducts']>>;
  configuration: Awaited<ReturnType<EdgeClient['getEdgeConfiguration']>>;
};
export type SectionResourceState<T> =
  { status: 'ready'; value: T } | { status: 'error'; error: unknown };
/** Per-Admin cache: never shared across users or persisted to browser storage. */
export class AdministrationResources {
  private values = new Map<keyof Resources, unknown>();
  private pending = new Map<keyof Resources, Promise<unknown>>();
  invalidate() {
    this.values.clear();
    this.pending.clear();
  }
  async load(
    client: EdgeClient,
    section: AdminSectionId,
    permissions: readonly string[],
    fresh = false,
  ) {
    if (!canOpenAdminSection(section, permissions)) return { denied: true as const, resources: {} };
    const keys: (keyof Resources)[] = section === 'personnel' ? ['people'] : ['admin'];
    if (section === 'taxes' || section === 'stations') keys.push('tax');
    if (section === 'tips') keys.push('configuration');
    if (section === 'stations' && permissions.includes('CATALOG_VIEW')) keys.push('products');
    const loaders: { [K in keyof Resources]: () => Promise<Resources[K]> } = {
      admin: () => client.getRestaurantAdministration(),
      tax: () => client.getTaxAdministration(),
      people: () => client.getPersonnel(),
      products: async () => await client.getProducts(),
      configuration: () => client.getEdgeConfiguration(),
    };
    const result: Partial<{ [K in keyof Resources]: SectionResourceState<Resources[K]> }> = {};
    await Promise.all(
      keys.map(async (key) => {
        try {
          if (fresh) { this.values.delete(key); this.pending.delete(key); }
          let value = this.values.get(key);
          if (!this.values.has(key)) {
            let request = this.pending.get(key);
            if (!request) {
              request = loaders[key]();
              this.pending.set(key, request);
            }
            try {
              value = await request;
              if (this.pending.get(key) === request) this.values.set(key, value);
            } finally {
              if (this.pending.get(key) === request) this.pending.delete(key);
            }
          }
          Object.assign(result, { [key]: { status: 'ready', value } });
        } catch (error) {
          Object.assign(result, { [key]: { status: 'error', error } });
        }
      }),
    );
    return { denied: false as const, resources: result };
  }
}

export interface DraftRecord<T> {
  section: AdminSectionId;
  baselineRevision: number;
  initial: T;
  current: T;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
}
export class AdministrationDraftStore {
  private records = new Map<string, DraftRecord<unknown>>();
  private pending = new Set<string>();
  observe<T>(key: string, section: AdminSectionId, current: T, revision: number) {
    const existing = this.records.get(key);
    if (existing) {
      existing.current = current;
      if (this.has(key) && JSON.stringify(existing.initial) === JSON.stringify(current)) {
        this.pending.delete(key);
        existing.dirty = false;
      }
      if (!this.has(key)) {
        existing.initial = current;
        existing.baselineRevision = revision;
      }
    } else
      this.records.set(key, {
        section,
        baselineRevision: revision,
        initial: current,
        current,
        dirty: this.has(key),
        saving: false,
        conflict: false,
      });
  }
  mark(key: string) {
    this.pending.add(key);
    const row = this.records.get(key);
    if (row) row.dirty = true;
  }
  saved(key?: string) {
    if (!key) return;
    this.pending.delete(key);
    const row = this.records.get(key);
    if (row) {
      row.dirty = false;
      row.saving = false;
      row.conflict = false;
      row.initial = row.current;
    }
  }
  saving(key: string, value: boolean) {
    const row = this.records.get(key);
    if (row) row.saving = value;
  }
  rebase(key: string, revision: number) {
    const row = this.records.get(key);
    if (row) {
      row.baselineRevision = revision;
      row.conflict = false;
    }
  }
  conflict(key: string) {
    const row = this.records.get(key);
    if (row) row.conflict = true;
  }
  get(key: string) {
    return this.records.get(key);
  }
  has(key: string) {
    return this.pending.has(key);
  }
  refresh(key: string, apply: () => void) {
    if (!this.has(key)) apply();
  }
  keys(section: AdminSectionId) {
    return [...this.records].filter(([, record]) => record.section === section).map(([key]) => key);
  }
  get dirty() {
    return this.pending.size > 0;
  }
  get pendingKeys() {
    return [...this.pending];
  }
}
