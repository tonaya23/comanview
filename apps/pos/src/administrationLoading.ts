import type { EdgeClient } from '@comanview/client-sdk';

export function administrationSections(permissions: readonly string[]) {
  return [0,1,2,3,4,5,6,7].filter(section => permissions.includes(section===7?'PERSONNEL_VIEW':'ADMINISTRATION_VIEW'));
}

export async function loadAdministrationResources(edge: EdgeClient, permissions: readonly string[]) {
  const allowed = (permission: string) => permissions.includes(permission);
  const [admin,tax,people,products,configuration] = await Promise.allSettled([
    allowed('ADMINISTRATION_VIEW') ? edge.getRestaurantAdministration() : Promise.resolve(null),
    allowed('ADMINISTRATION_VIEW') ? edge.getTaxAdministration() : Promise.resolve(null),
    allowed('PERSONNEL_VIEW') ? edge.getPersonnel() : Promise.resolve(null),
    allowed('ADMINISTRATION_VIEW') && allowed('CATALOG_VIEW') ? edge.getProducts() : Promise.resolve([]),
    allowed('ADMINISTRATION_VIEW') ? edge.getEdgeConfiguration() : Promise.resolve(null),
  ]);
  return {admin,tax,people,products,configuration};
}

/** Draft revisions remain pinned until that specific draft has been saved. */
export class AdministrationDrafts {
  private pending = new Set<string>();
  mark(key: string) { this.pending.add(key); }
  saved(key?: string) { if(key)this.pending.delete(key); }
  has(key: string) { return this.pending.has(key); }
  refresh(key: string, apply: ()=>void) { if(!this.has(key))apply(); }
  get dirty() { return this.pending.size>0; }
}
