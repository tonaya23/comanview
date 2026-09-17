// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EdgeClientError } from '@comanview/client-sdk';
import { KdsTicketSchema, PermissionCodes } from '@comanview/contracts';
import { getUserGuidance } from '@comanview/ui';
import { App } from './App.js';
import { KitchenTicket, kitchenActionReason, nextKitchenAction } from './KitchenTicket.js';
import { KitchenViewportNotice, kitchenViewportLimited } from './KitchenViewportNotice.js';
import { getKdsErrorMessage } from './kdsLogic.js';
import { readFileSync } from 'node:fs';

const api = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getKdsStations: vi.fn(),
  getKdsTickets: vi.fn(),
  startKdsTicket: vi.fn(),
  markKdsTicketReady: vi.fn(),
}));
vi.mock('@comanview/client-sdk', async (original) => ({
  ...(await original<typeof import('@comanview/client-sdk')>()),
  createEdgeClient: () => api,
  loadDeviceIdentity: async () => ({
    deviceId: 'fixture-device',
    displayName: 'Cocina',
    authorizationStatus: 'ACTIVE',
  }),
  loadDevicePairing: async () => null,
}));
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
function ticket() {
  return KdsTicketSchema.parse({
    ticketId: 'ticket',
    orderId: id,
    orderNumber: '7',
    orderType: 'TABLE',
    roundId: id,
    roundNumber: 1,
    stationId: id,
    stationName: 'Cocina',
    status: 'PENDING',
    sentAt: '2026-09-13T12:00:00Z',
    preparingAt: null,
    readyAt: null,
    items: [
      {
        orderItemId: id,
        quantity: 2,
        productName: 'Tacos',
        modifiers: [{ modifierOptionId: id, name: 'Salsa verde' }],
        specialInstructions: 'Sin cebolla',
        prepStatus: 'PENDING',
      },
    ],
  });
}
class Socket {
  static current: Socket;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: {code:number}) => void) | null = null;
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
  localStorage.setItem('comanview.kds.sessionToken', 'fixture');
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  api.getCurrentSession.mockResolvedValue({
    user: {
      id,
      displayName: 'Cocinero',
      roles: ['COOK'],
      permissions: Object.values(PermissionCodes),
    },
  });
  api.getKdsStations.mockResolvedValue([
    { stationId: id, name: 'Cocina' },
    { stationId: other, name: 'Barra' },
  ]);
  api.getKdsTickets.mockResolvedValue([ticket()]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function start() {
  render(<App />);
  await screen.findByRole('article', { name: 'Pedido 7' });
}
async function refresh() {
  await act(async () => Socket.current.message({ type: 'AUTHENTICATED' }));
}
describe('Kitchen presentation and transitions', () => {
  it('retains every ready ticket in a labelled keyboard-scrollable lane without shrinking cards', async () => {
    api.getKdsTickets.mockResolvedValue(Array.from({ length: 9 }, (_, index) => ({ ...ticket(), ticketId: `ready-${index}`, orderNumber: String(index), status: 'READY', readyAt: '2026-09-13T12:00:00Z' })));
    render(<App/>);
    await screen.findByRole('article', { name: 'Pedido 8' });
    const lane = screen.getByRole('region', { name: 'Comandas: LISTOS' });
    expect(lane.getAttribute('tabindex')).toBe('0');
    expect(lane.querySelectorAll('article')).toHaveLength(9);
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toContain('.kds-shell .ticket-list > .ticket { flex:0 0 auto; }');
    expect(css).toContain('flex-direction:column; min-height:0; overflow:auto;');
    expect(api.markKdsTicketReady).not.toHaveBeenCalled();
  });
  it.each([1013,1008])('handles WS close %s without retrying transitions or renewing login',async code=>{
    await start();vi.useFakeTimers();
    const previous=Socket.current;
    await act(async()=>previous.onclose?.({code}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
    if(code===1013){
      expect(Socket.current).not.toBe(previous);
      const reads=api.getKdsTickets.mock.calls.length;
      await refresh();
      expect(api.getKdsTickets.mock.calls.length).toBeGreaterThan(reads);
      expect(localStorage.getItem('comanview.kds.sessionToken')).toBe('fixture');
    }else{
      expect(localStorage.getItem('comanview.kds.sessionToken')).toBeNull();
      expect(Socket.current).toBe(previous);
    }
    expect(api.getCurrentSession).toHaveBeenCalledTimes(1);
    expect(api.markKdsTicketReady).not.toHaveBeenCalled();
    expect(api.startKdsTicket).not.toHaveBeenCalled();
  });
  it.each(['PERSONNEL_SECURITY_UNAVAILABLE','AUTH_SESSION_INVALID'] as const)('classifies background session error %s without conflating availability and revocation',async code=>{
    await start();api.getKdsTickets.mockRejectedValue(new EdgeClientError('raw',code,401));
    await refresh();
    await waitFor(()=>expect(localStorage.getItem('comanview.kds.sessionToken')).toBe(code==='AUTH_SESSION_INVALID'?null:'fixture'));
    if(code==='PERSONNEL_SECURITY_UNAVAILABLE'){
      api.getKdsTickets.mockResolvedValue([ticket()]);await refresh();
      await screen.findByRole('article',{name:'Pedido 7'});
      expect(localStorage.getItem('comanview.kds.sessionToken')).toBe('fixture');
    }
  });
  it('shares safe guidance for permissions, inconsistent state and stale transitions', () => {
    for (const code of [
      'PERMISSION_DENIED',
      'KDS_INVALID_TRANSITION',
      'KDS_INCONSISTENT_STATE',
      'KDS_TICKET_NOT_FOUND',
    ] as const) {
      const message = getKdsErrorMessage(new EdgeClientError('raw-secret', code, 409));
      expect(message).toContain(getUserGuidance(code).explanation);
      expect(message).not.toContain('raw-secret');
    }
    expect(getKdsErrorMessage(new Error('private'))).not.toContain('private');
  });
  it('supports only the valid next transition and explains disabled conditions', () => {
    expect(nextKitchenAction('PENDING')).toBe('PREPARING');
    expect(nextKitchenAction('PREPARING')).toBe('READY');
    expect(nextKitchenAction('READY')).toBeNull();
    const state = { busy: false, connected: true, authorized: true, stationAvailable: true };
    expect(kitchenActionReason(state)).toBeNull();
    expect(kitchenActionReason({ ...state, busy: true })).toContain('confirmación');
    expect(kitchenActionReason({ ...state, connected: false })).toContain('conexión');
    expect(kitchenActionReason({ ...state, authorized: false })).toContain('permiso');
    expect(kitchenActionReason({ ...state, stationAvailable: false })).toContain('estación');
  });
  it('shows elapsed time and textual urgency, context, notes and accessible action name', () => {
    render(
      <KitchenTicket
        ticket={ticket()}
        now={Date.parse('2026-09-13T12:11:00Z')}
        reason={null}
        onTransition={vi.fn()}
      />,
    );
    expect(screen.getByText('11:00')).toBeTruthy();
    expect(screen.getByText('Demora alta')).toBeTruthy();
    expect(screen.getByText(/Servicio de mesa/)).toBeTruthy();
    expect(screen.getByText('Sin cebolla')).toBeTruthy();
    expect(screen.getByText('+ Salsa verde')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Comenzar preparación · Pedido 7 · Ronda 1' }),
    ).toBeTruthy();
  });
  it('links disabled reason and never dispatches a disabled or READY action', async () => {
    const action = vi.fn();
    const { rerender } = render(
      <KitchenTicket
        ticket={ticket()}
        now={Date.now()}
        reason="Solo consulta"
        onTransition={action}
      />,
    );
    const button = screen.getByRole('button');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Solo consulta',
    );
    await userEvent.click(button);
    expect(action).not.toHaveBeenCalled();
    rerender(
      <KitchenTicket
        ticket={{ ...ticket(), status: 'READY', readyAt: '2026-09-13T12:04:00Z' }}
        now={Date.now()}
        reason={null}
        onTransition={action}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Preparación terminada')).toBeTruthy();
    expect(screen.getByText('04:00')).toBeTruthy();
  });
  it('keeps original start/ready commands and keyboard operation', async () => {
    await start();
    api.startKdsTicket.mockResolvedValue({});
    api.getKdsTickets.mockResolvedValue([{ ...ticket(), status: 'PREPARING' }]);
    const begin = screen.getByRole('button', { name: /Comenzar preparación/ });
    begin.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('button', { name: /Marcar listo/ });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Marcar listo/ })),
    );
    expect(api.startKdsTicket).toHaveBeenCalledExactlyOnceWith(id, id, {
      commandId: expect.any(String),
    });
    api.markKdsTicketReady.mockResolvedValue({});
    api.getKdsTickets.mockResolvedValue([
      { ...ticket(), status: 'READY', readyAt: '2026-09-13T12:04:00Z' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: /Marcar listo/ }));
    await screen.findByText('Preparación terminada');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Pedido 7' })),
    );
    expect(api.markKdsTicketReady).toHaveBeenCalledExactlyOnceWith(id, id, {
      commandId: expect.any(String),
    });
  });
  it('distinguishes websocket reconnect from loss of local HTTP and recovers', async () => {
    await start();
    await refresh();
    expect(screen.getByText('Operación local disponible')).toBeTruthy();
    await act(async () => Socket.current.onclose?.({code:1006}));
    expect(screen.getByText('Reconectando avisos en vivo')).toBeTruthy();
    api.getKdsTickets.mockRejectedValue(new EdgeClientError('raw', 'EDGE_UNREACHABLE', null));
    await refresh();
    await screen.findByText('Sin conexión local');
    expect(screen.getByRole('button', { name: /Comenzar preparación/ }).matches(':disabled')).toBe(
      true,
    );
    api.getKdsTickets.mockResolvedValue([ticket()]);
    await refresh();
    await screen.findByText('Operación local disponible');
    expect(screen.getByRole('button', { name: /Comenzar preparación/ }).matches(':disabled')).toBe(
      false,
    );
  });
  it('explains missing station without silently switching to a different kitchen', async () => {
    localStorage.setItem('comanview-kds-station', 'missing');
    api.getKdsTickets.mockResolvedValue([]);
    render(<App />);
    await screen.findByText('Estación no disponible');
    expect(screen.queryByRole('article')).toBeNull();
    api.getKdsTickets.mockResolvedValue([ticket()]);
    await userEvent.click(screen.getByRole('button', { name: 'Cocina' }));
    await screen.findByRole('article', { name: 'Pedido 7' });
    expect(screen.queryByText('Estación no disponible')).toBeNull();
  });
  it('removes the board if the current station disappears remotely', async () => {
    await start();
    api.getKdsStations.mockResolvedValue([{ stationId: other, name: 'Barra' }]);
    await refresh();
    await screen.findByText('Estación no disponible');
    expect(screen.queryByRole('article')).toBeNull();
    expect(localStorage.getItem('comanview-kds-station')).toBe(id);
  });
  it('keeps transition rejection visible after an authoritative successful refresh', async () => {
    await start();
    api.startKdsTicket.mockRejectedValue(new EdgeClientError('raw', 'KDS_INVALID_TRANSITION', 409));
    api.getKdsTickets.mockResolvedValue([{ ...ticket(), status: 'PREPARING' }]);
    await userEvent.click(screen.getByRole('button', { name: /Comenzar preparación/ }));
    await screen.findByRole('button', { name: /Marcar listo/ });
    expect(screen.getByText(/La comanda cambió/)).toBeTruthy();
    expect(api.startKdsTicket).toHaveBeenCalledTimes(1);
  });
  it('does not classify a backend permission denial as local disconnection', async () => {
    api.getKdsTickets.mockRejectedValue(new EdgeClientError('raw', 'PERMISSION_DENIED', 403));
    render(<App />);
    await screen.findByText(/No tienes permiso para esta acción/);
    expect(screen.queryByText('Sin conexión local')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
  });
  it('disables preparation for view-only roles without changing backend authorization', async () => {
    api.getCurrentSession.mockResolvedValue({
      user: { id, displayName: 'Observador', roles: [], permissions: [PermissionCodes.KDS_VIEW] },
    });
    await start();
    expect(screen.getByRole('button', { name: /Comenzar preparación/ }).matches(':disabled')).toBe(
      true,
    );
    expect(screen.getByText(/Solo puedes consultar/)).toBeTruthy();
    expect(api.startKdsTicket).not.toHaveBeenCalled();
  });
  it('warns below either minimum dimension and clears warning after resize', () => {
    expect(kitchenViewportLimited(1024, 640)).toBe(false);
    expect(kitchenViewportLimited(1023, 800)).toBe(true);
    expect(kitchenViewportLimited(1280, 639)).toBe(true);
    vi.stubGlobal('innerWidth', 480);
    render(<KitchenViewportNotice />);
    expect(screen.getByText('Pantalla de cocina: vista limitada')).toBeTruthy();
    vi.stubGlobal('innerWidth', 1280);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('ignores delayed responses from a previously selected station', async () => {
    await start();
    let resolveOld: (value: ReturnType<typeof ticket>[]) => void = () => {};
    api.getKdsTickets.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof ticket>[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    await refresh();
    api.getKdsTickets.mockResolvedValue([
      { ...ticket(), ticketId: 'bar-ticket', stationId: other, orderNumber: '9' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Barra' }));
    await screen.findByRole('article', { name: 'Pedido 9' });
    await act(async () => resolveOld([ticket()]));
    expect(screen.queryByRole('article', { name: 'Pedido 7' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Pedido 9' })).toBeTruthy();
  });
});
