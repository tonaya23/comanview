// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EdgeClientError } from '@comanview/client-sdk';
import { OrderSchema, PermissionCodes } from '@comanview/contracts';
import { getUserGuidance } from '@comanview/ui';
import { App } from './App.js';
import { initialNavigation, waiterNavigation } from './waiterNavigation.js';
import { waiterError } from './waiterLogic.js';
import { readFileSync } from 'node:fs';

const api = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getCategories: vi.fn(),
  getProducts: vi.fn(),
  getTables: vi.fn(),
  getOrder: vi.fn(),
  createOrder: vi.fn(),
  addOrderItem: vi.fn(),
  updateDraftOrderItemConfiguration: vi.fn(),
  sendRound: vi.fn(),
  cancelEmptyTableOrder: vi.fn(),
}));
vi.mock('@comanview/client-sdk', async (original) => ({
  ...(await original<typeof import('@comanview/client-sdk')>()),
  createEdgeClient: () => api,
  loadDeviceIdentity: async () => ({
    deviceId: 'test-device',
    displayName: 'Mesero',
    authorizationStatus: 'ACTIVE',
  }),
  loadDevicePairing: async () => null,
}));
const id = '11111111-1111-4111-8111-111111111111',
  productId = '22222222-2222-4222-8222-222222222222';
const money = (amount: number) => ({ amount, currency: 'MXN' });
function sale() {
  return OrderSchema.parse({
    id,
    tenantId: id,
    locationId: id,
    orderType: 'TABLE',
    channel: 'WAITER',
    currency: 'MXN',
    status: 'OPEN',
    tableIds: [id],
    items: [
      {
        id: productId,
        productSnapshot: {
          productId,
          productName: 'Taco',
          basePrice: money(10000),
          taxRateBasisPoints: 1600,
          taxCalculationMode: 'TAX_ADDED',
          stationId: null,
          selectedModifiers: [],
        },
        quantity: 1,
        lineTotal: money(11600),
        specialInstructions: 'Sin cebolla',
        status: 'DRAFT',
        addedAt: '2026-09-13',
        sentAt: null,
      },
    ],
    rounds: [],
    subtotal: money(10000),
    taxTotal: money(1600),
    total: money(11600),
    paidAmount: money(0),
    balanceDue: money(11600),
    tipTotal: money(0),
    payments: [],
    version: 7,
    createdAt: '2026-09-13',
    updatedAt: '2026-09-13',
  });
}
const table = () => ({
  id,
  name: 'Mesa terraza',
  zone: 'Terraza',
  active: true,
  status: 'OPEN',
  activeOrderId: id,
  activeOrderNumber: '7',
  capacity: 4,
  draftItemCount: 1,
  preparingItemCount: 0,
  readyItemCount: 0,
});
class Socket {
  static current: Socket;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    Socket.current = this;
  }
  send() {}
  close() {}
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('WebSocket', Socket);
  localStorage.clear();
  localStorage.setItem('comanview.waiter.sessionToken', 'test-session');
  api.getCurrentSession.mockResolvedValue({
    user: {
      id,
      displayName: 'Mesero',
      roles: ['WAITER'],
      permissions: Object.values(PermissionCodes),
    },
  });
  api.getCategories.mockResolvedValue([{ id: 'food', name: 'Comida', active: true }]);
  api.getProducts.mockResolvedValue([
    {
      id: productId,
      name: 'Taco',
      categoryId: 'food',
      active: true,
      available: true,
      displayOrder: 0,
      basePrice: money(10000),
      modifierGroups: [],
    },
  ]);
  api.getTables.mockResolvedValue([table()]);
  api.getOrder.mockResolvedValue(sale());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function start() {
  render(<App />);
  await screen.findByRole('button', { name: /Mesa terraza/ });
}
async function select() {
  await start();
  await userEvent.click(screen.getByRole('button', { name: /Mesa terraza/ }));
  await screen.findByRole('heading', { name: 'Productos', level: 1 });
}
async function openOrder() {
  await select();
  await userEvent.click(screen.getByRole('button', { name: 'Pedido · 1 sin enviar' }));
}
async function reconnect() {
  await act(async () => {
    Socket.current.message({ type: 'AUTHENTICATED' });
  });
}

describe('Waiter task navigation', () => {
  it('keeps the real multi-table context across views without creating another order', async () => {
    api.getTables.mockResolvedValue([table(), { ...table(), id: productId, name: 'Mesa patio', zone: 'Patio' }]);
    api.getOrder.mockResolvedValue({ ...sale(), tableIds: [id, productId] });
    await select();
    expect(screen.getByRole('region', { name: 'Contexto de servicio' }).textContent).toContain('Terraza · Mesa terraza + Patio · Mesa patio');
    await userEvent.click(screen.getByRole('button', { name: 'Pedido · 1 sin enviar' }));
    expect(screen.getByRole('region', { name: 'Contexto de servicio' }).textContent).toContain('1 pendientes de enviar');
    expect(api.createOrder).not.toHaveBeenCalled();
  });
  it('still requires modifier configuration and never sends an incomplete add command', async () => {
    api.getProducts.mockResolvedValue([{ id: productId, name: 'Taco', active: true, available: true, displayOrder: 0, basePrice: money(10000), modifierGroups: [{ displayOrder: 0, priceDeltaOverrides: {}, modifierGroup: { id, name: 'Salsa', active: true, minSelections: 1, maxSelections: 1, options: [{ id, name: 'Verde', active: true, available: true, priceDelta: money(0) }] } }] }]);
    await select();
    await userEvent.click(screen.getByRole('button', { name: /Taco/ }));
    const dialog = screen.getByRole('dialog', { name: 'Taco' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(screen.getByText('Selecciona al menos 1.')).toBeTruthy();
    expect(api.addOrderItem).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verde' }));
    api.addOrderItem.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(api.addOrderItem).toHaveBeenCalledExactlyOnceWith(id, { commandId: expect.any(String), expectedVersion: 7, productId, selectedModifierIds: [id], specialInstructions: '' });
  });
  it('keeps the acknowledged new order if the following map refresh fails', async () => {
    api.getTables.mockResolvedValueOnce([{ ...table(), status: 'FREE', activeOrderId: null }]);
    api.createOrder.mockResolvedValue(sale());
    await start();
    api.getTables.mockRejectedValue(new EdgeClientError('raw', 'EDGE_UNREACHABLE', null));
    await userEvent.click(screen.getByRole('button', { name: /Mesa terraza/ }));
    await screen.findByRole('heading', { name: 'Productos', level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Pedido · 1 sin enviar' }));
    expect(screen.getByText(/Sin cebolla/)).toBeTruthy();
    expect(api.createOrder).toHaveBeenCalledTimes(1);
  });
  it('keeps touch targets at least 44px in the single-task order surface', async () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/styles.css', 'utf8').replace(/@import[^;]+;/g, '');
    document.head.append(style);
    try {
      await openOrder();
      for (const button of screen.getAllByRole('button')) {
        expect(
          parseFloat(getComputedStyle(button).minHeight),
          button.textContent ?? '',
        ).toBeGreaterThanOrEqual(44);
      }
    } finally {
      style.remove();
    }
  });
  it('ignores an old poll arriving after a newer round acknowledgement', async () => {
    await openOrder();
    let resolveOld: (order: ReturnType<typeof sale>) => void = () => {};
    api.getOrder.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof sale>>((resolve) => {
          resolveOld = resolve;
        }),
    );
    await reconnect();
    const sent = sale();
    sent.version = 8;
    sent.items[0]!.status = 'SENT';
    api.sendRound.mockResolvedValue(sent);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ronda' }));
    await screen.findByText(/Ronda enviada/);
    await act(async () => resolveOld(sale()));
    expect(screen.getByRole('button', { name: 'Pedido · 0 sin enviar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar ronda' }).matches(':disabled')).toBe(true);
  });
  it('does not retain an editable order when remote closure is known but table polling fails', async () => {
    await openOrder();
    api.getOrder.mockResolvedValue({ ...sale(), version: 8, status: 'CLOSED' });
    api.getTables.mockRejectedValue(new EdgeClientError('raw', 'EDGE_UNREACHABLE', null));
    await reconnect();
    await screen.findByRole('heading', { name: 'Mesas', level: 1 });
    expect(screen.queryByRole('button', { name: 'Enviar ronda' })).toBeNull();
  });
  it('closes an unsafe item edit after the item was sent remotely without repeating the edit', async () => {
    await openOrder();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const sent = sale();
    sent.version = 8;
    sent.items[0]!.status = 'SENT';
    api.getOrder.mockResolvedValue(sent);
    await reconnect();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/producto cambió o ya fue enviado/)).toBeTruthy();
    expect(api.updateDraftOrderItemConfiguration).not.toHaveBeenCalled();
  });
  it('has typed view/reference state and no order payload or side effects', () => {
    let state = waiterNavigation(initialNavigation, { type: 'zone', id: 'Terraza' });
    state = waiterNavigation(state, { type: 'category', id: 'food' });
    state = waiterNavigation(state, { type: 'selected', orderId: id });
    expect(state).toEqual({ view: 'products', orderId: id, categoryId: 'food', zoneId: 'Terraza' });
    state = waiterNavigation(state, { type: 'order' });
    expect(state.view).toBe('order');
    state = waiterNavigation(state, { type: 'back' });
    expect(state.view).toBe('products');
    state = waiterNavigation(state, { type: 'back' });
    expect(state).toEqual({ view: 'tables', orderId: id, categoryId: 'food', zoneId: 'Terraza' });
    expect(waiterNavigation(initialNavigation, { type: 'order' })).toEqual(initialNavigation);
  });
  it('mounts one task at a time and preserves order/drafts/category/zone through Back', async () => {
    await select();
    await userEvent.click(screen.getByRole('button', { name: 'Comida' }));
    expect(screen.queryByRole('region', { name: 'Pedido actual' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pedido · 1 sin enviar' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText(/Sin cebolla/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pedido', level: 1 })).toBe(document.activeElement);
    await userEvent.click(screen.getByRole('button', { name: '← Productos' }));
    expect(screen.getByRole('button', { name: 'Comida' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: '← Mesas' }));
    expect(screen.getByRole('button', { name: /Terraza.*1/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pedido · 1 sin enviar' }));
    expect(screen.getByText(/Sin cebolla/)).toBeTruthy();
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(api.cancelEmptyTableOrder).not.toHaveBeenCalled();
    expect(api.addOrderItem).not.toHaveBeenCalled();
  });
  it('retains explicit free-table create payload only on selection', async () => {
    api.getTables.mockResolvedValueOnce([{ ...table(), status: 'FREE', activeOrderId: null }]);
    api.createOrder.mockResolvedValue(sale());
    await select();
    expect(api.createOrder).toHaveBeenCalledExactlyOnceWith({
      commandId: expect.any(String),
      orderType: 'TABLE',
      channel: 'WAITER',
      currency: 'MXN',
      tableIds: [id],
    });
  });
  it('adds a note-only product directly without a dialog and preserves the command payload', async () => {
    await select();
    const button = screen.getByRole('button', { name: /Taco/ });
    api.addOrderItem.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(api.addOrderItem).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      expectedVersion: 7,
      productId,
      selectedModifierIds: [],
      specialInstructions: '',
    });
  });
  it('keeps notes editable in the labelled dialog without adding another item', async () => {
    await openOrder();
    const button = screen.getByRole('button', { name: 'Editar' });
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Taco' });
    fireEvent.change(within(dialog).getByLabelText('Instrucciones especiales'), { target: { value: 'Salsa aparte' } });
    api.updateDraftOrderItemConfiguration.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
    expect(api.updateDraftOrderItemConfiguration).toHaveBeenCalledExactlyOnceWith(id, productId, {
      commandId: expect.any(String), expectedVersion: 7, selectedModifierIds: [], specialInstructions: 'Salsa aparte',
    });
    expect(api.addOrderItem).not.toHaveBeenCalled();
  });
  it('refreshes tables and the current order on reconnect without changing the task', async () => {
    await openOrder();
    api.getOrder.mockResolvedValue({ ...sale(), version: 8, total: money(10800) });
    await reconnect();
    await screen.findByText('$108.00');
    expect(screen.getByRole('heading', { name: 'Pedido', level: 1 })).toBeTruthy();
    expect(api.getTables.mock.calls.length).toBeGreaterThan(2);
    expect(api.createOrder).not.toHaveBeenCalled();
    await act(async () => Socket.current.onclose?.());
    expect(screen.getByText('Reconectando avisos en vivo')).toBeTruthy();
    expect(screen.queryByText('Sin conexión local')).toBeNull();
  });
  it('keeps safe configuration intent on OCC and retries only by an explicit command', async () => {
    await openOrder();
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Instrucciones especiales'), {
      target: { value: 'Sin salsa' },
    });
    api.updateDraftOrderItemConfiguration.mockRejectedValueOnce(
      new EdgeClientError('private raw', 'STALE_ORDER_VERSION', 409),
    );
    api.getOrder.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText(/La venta cambió/);
    expect((screen.getByLabelText('Instrucciones especiales') as HTMLTextAreaElement).value).toBe(
      'Sin salsa',
    );
    api.updateDraftOrderItemConfiguration.mockResolvedValue({ ...sale(), version: 9 });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(api.updateDraftOrderItemConfiguration).toHaveBeenLastCalledWith(id, productId, {
      commandId: expect.any(String),
      expectedVersion: 8,
      selectedModifierIds: [],
      specialInstructions: 'Sin salsa',
    });
    expect(screen.queryByText('private raw')).toBeNull();
  });
  it.each(['CLOSED', 'CANCELLED'] as const)(
    'returns safely to tables when the order is remotely %s',
    async (status) => {
      await openOrder();
      api.getOrder.mockResolvedValue({ ...sale(), version: 8, status });
      await reconnect();
      await screen.findByRole('heading', { name: 'Mesas', level: 1 });
      expect(screen.getByText(/ya fue cerrado o cancelado/)).toBeTruthy();
      expect(api.cancelEmptyTableOrder).not.toHaveBeenCalled();
    },
  );
  it('returns to tables when the current order no longer exists', async () => {
    await openOrder();
    api.getOrder.mockRejectedValue(new EdgeClientError('raw', 'ORDER_NOT_FOUND', 404));
    await reconnect();
    await screen.findByText(/pedido ya no está disponible/);
    expect(screen.getByRole('heading', { name: 'Mesas', level: 1 })).toBeTruthy();
  });
  it.each(['reassigned', 'inactive'])(
    'handles a table %s remotely without creating a replacement order',
    async (mode) => {
      await openOrder();
      api.getTables.mockResolvedValue([
        {
          ...table(),
          active: mode !== 'inactive',
          activeOrderId: mode === 'reassigned' ? productId : id,
        },
      ]);
      await reconnect();
      await screen.findByRole('heading', { name: 'Mesas', level: 1 });
      expect(screen.getByText(/asignación de mesas cambió/)).toBeTruthy();
      expect(api.createOrder).not.toHaveBeenCalled();
    },
  );
  it('keeps permission errors distinct, safe and shared rather than exposing raw text', () => {
    expect(waiterError(new EdgeClientError('secret', 'PERMISSION_DENIED', 403))).toContain(
      getUserGuidance('PERMISSION_DENIED').explanation,
    );
    expect(waiterError(new EdgeClientError('secret', 'UNKNOWN_EDGE_ERROR', 500))).not.toContain(
      'secret',
    );
    expect(waiterError(new EdgeClientError('raw', 'TABLE_OCCUPIED', 409))).toContain(
      'mesa está ocupada',
    );
  });
  it('shows acknowledged round with unchanged OCC command and no automatic repeat', async () => {
    await openOrder();
    const next = sale();
    next.version = 8;
    next.items[0]!.status = 'SENT';
    api.sendRound.mockResolvedValue(next);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ronda' }));
    await screen.findByText(/Ronda enviada/);
    expect(api.sendRound).toHaveBeenCalledExactlyOnceWith(id, {
      commandId: expect.any(String),
      expectedVersion: 7,
    });
    expect(screen.getByRole('button', { name: 'Enviar ronda' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Pedido · 0 sin enviar' })).toBeTruthy();
  });
  it('does not confuse successful cancellation with a failed subsequent table refresh', async () => {
    api.getOrder.mockResolvedValue({ ...sale(), items: [] });
    await select();
    await userEvent.click(screen.getByRole('button', { name: 'Pedido · 0 sin enviar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar mesa' }));
    api.cancelEmptyTableOrder.mockResolvedValue({});
    api.getTables.mockRejectedValue(new EdgeClientError('raw', 'EDGE_UNREACHABLE', null));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar y liberar' }));
    await screen.findByText(/La cancelación se confirmó/);
    expect(screen.getByRole('heading', { name: 'Mesas', level: 1 })).toBeTruthy();
    expect(api.cancelEmptyTableOrder).toHaveBeenCalledTimes(1);
  });
});
