import type { OrderResponse, RestaurantTableResponse } from '@comanview/contracts';

// Navigation holds references only. The fetched Order remains the sole working order.
export type WaiterNavigation = {
  zoneId: string | null;
  categoryId: string | null;
} & ({ view: 'tables'; orderId: string | null } | { view: 'products' | 'order'; orderId: string });
export const initialNavigation: WaiterNavigation = {
  view: 'tables',
  orderId: null,
  zoneId: null,
  categoryId: null,
};
export type WaiterNavigationAction =
  | { type: 'zone'; id: string }
  | { type: 'category'; id: string | null }
  | { type: 'selected'; orderId: string }
  | { type: 'products' | 'order' | 'tables' | 'back' | 'invalidated' | 'reset' };
export function waiterNavigation(
  state: WaiterNavigation,
  action: WaiterNavigationAction,
): WaiterNavigation {
  switch (action.type) {
    case 'zone':
      return { ...state, zoneId: action.id };
    case 'category':
      return { ...state, categoryId: action.id };
    case 'selected':
      return { ...state, view: 'products', orderId: action.orderId };
    case 'products':
    case 'order':
      return state.orderId ? { ...state, view: action.type, orderId: state.orderId } : state;
    case 'tables':
      return { ...state, view: 'tables' };
    case 'back':
      return state.view === 'order' ? { ...state, view: 'products' } : { ...state, view: 'tables' };
    case 'invalidated':
      return { ...state, view: 'tables', orderId: null };
    case 'reset':
      return initialNavigation;
  }
}
export function waiterContextProblem(
  previous: OrderResponse,
  current: OrderResponse,
  tables: RestaurantTableResponse[],
): string | null {
  if (current.status !== 'OPEN')
    return 'Este pedido ya fue cerrado o cancelado. Volvimos a Mesas para que elijas dónde continuar.';
  if (
    previous.tableIds.some((id) => !current.tableIds.includes(id)) ||
    current.tableIds.length === 0 ||
    current.tableIds.some(
      (id) =>
        !tables.some(
          (table) => table.id === id && table.active && table.activeOrderId === current.id,
        ),
    )
  )
    return 'La asignación de mesas cambió o ya no está disponible. Revisa el mapa y selecciona la mesa vigente; el pedido se conserva en el restaurante.';
  return null;
}
