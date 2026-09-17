// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EdgeClientError } from '@comanview/client-sdk';
import {
  OrderSchema,
  PermissionCodes,
  RestaurantAdministrationStateSchema,
} from '@comanview/contracts';
import { getUserGuidance } from '@comanview/ui';
import { App } from './App.js';
import {
  ConnectionStatus,
  connectionPresentation,
  licenseModeLabel,
  PosAction,
  PosFeedback,
} from './PosOperationalUX.js';
import { getErrorMessage } from './posLogic.js';

const api = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getHealth: vi.fn(),
  getCategories: vi.fn(),
  getProducts: vi.fn(),
  getTables: vi.fn(),
  getOpenCounterOrders: vi.fn(),
  getCurrentCashSession: vi.fn(),
  getPaymentConfig: vi.fn(),
  getLicensingStatus: vi.fn(),
  getOrder: vi.fn(),
  getRecentPrintJobs: vi.fn(),
  getRestaurantAdministration: vi.fn(),
  getDevices: vi.fn(),
  getPendingPairings: vi.fn(),
  getInstallationReadiness: vi.fn(),
  getBackupStatus: vi.fn(),
  createOrder: vi.fn(),
  createPayment: vi.fn(),
  sendRound: vi.fn(),
  addOrderItem: vi.fn(),
  requestPrecheck: vi.fn(),
  openCashSession: vi.fn(),
  cancelOrder: vi.fn(),
  getTaxAdministration: vi.fn(),
}));
vi.mock('@comanview/client-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@comanview/client-sdk')>()),
  createEdgeClient: () => api,
  loadDeviceIdentity: async () => ({
    deviceId: 'fixture-device',
    displayName: 'Caja de prueba',
    authorizationStatus: 'ACTIVE',
  }),
  loadDevicePairing: async () => null,
}));
const id = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const money = (amount: number) => ({ amount, currency: 'MXN' });
function sale() {
  const item = {
    id: productId,
    productSnapshot: {
      productId,
      productName: 'Taco de prueba',
      basePrice: money(5000),
      taxRateBasisPoints: 1600,
      taxCalculationMode: 'TAX_ADDED',
      stationId: null,
      selectedModifiers: [],
    },
    quantity: 1,
    lineTotal: money(5800),
    specialInstructions: 'Sin cebolla',
    status: 'DRAFT',
    addedAt: '2026-09-13',
    sentAt: null,
  };
  return OrderSchema.parse({
    id,
    tenantId: id,
    locationId: id,
    orderType: 'TABLE',
    channel: 'POS',
    currency: 'MXN',
    status: 'OPEN',
    tableIds: [id],
    items: [item, { ...item, id, status: 'SENT' }],
    rounds: [],
    subtotal: money(10000),
    taxTotal: money(1600),
    total: money(11600),
    paidAmount: money(1600),
    balanceDue: money(10000),
    tipTotal: money(0),
    payments: [],
    version: 7,
    createdAt: '2026-09-13',
    updatedAt: '2026-09-13',
  });
}
const admin = () =>
  RestaurantAdministrationStateSchema.parse({
    businessProfile: {
      commercialName: 'Restaurante de prueba',
      legalName: null,
      phone: null,
      email: null,
      logo: null,
      address: {},
      operatingHours: [],
      confirmed: true,
      version: 1,
    },
    operational: {
      timeZone: 'America/Matamoros',
      rollover: '04:00',
      currency: 'MXN',
      currencyLocked: true,
      defaultCashRegisterId: null,
      defaultTaxProfileId: null,
      tipPreferences: null,
      businessDayVersion: 1,
      fiscalPolicyVersion: 1,
      version: 1,
    },
    cashRegisters: [],
    stations: [],
    zones: [],
    tables: [],
  });
class Socket {
  static current: Socket;
  onclose: ((event: {code:number}) => void) | null = null;
  onmessage: ((event: {data:string}) => void) | null = null;
  constructor(){Socket.current=this;}
  send() {}
  close() {}
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'WebSocket',
    Socket,
  );
  window.localStorage.clear();
  window.localStorage.setItem('comanview.pos.sessionToken', 'test-session');
  window.localStorage.setItem('comanview.pos.currentOrderId', id);
  api.getCurrentSession.mockResolvedValue({
    user: {
      id,
      displayName: 'Responsable',
      roles: ['OWNER'],
      permissions: Object.values(PermissionCodes),
    },
  });
  api.getHealth.mockResolvedValue({ status: 'UP', recoveryState: 'NORMAL' });
  api.getCategories.mockResolvedValue([]);
  api.getProducts.mockResolvedValue([
    {
      id: productId,
      name: 'Taco de prueba',
      active: true,
      available: true,
      basePrice: money(5000),
      modifierGroups: [],
      displayOrder: 0,
    },
  ]);
  api.getTables.mockResolvedValue([
    {
      id,
      name: 'Mesa terraza',
      status: 'OPEN',
      activeOrderId: id,
      activeOrderNumber: '7',
      total: money(11600),
      balanceDue: money(10000),
      draftItemCount: 1,
      preparingItemCount: 1,
      readyItemCount: 0,
    },
  ]);
  api.getOpenCounterOrders.mockResolvedValue([]);
  api.getCurrentCashSession.mockResolvedValue({
    session: { id, businessDate: '2026-09-13', expectedCash: null, blindCashCount: true },
  });
  api.getPaymentConfig.mockResolvedValue({
    tipsEnabled: true,
    percentageOptionsBasisPoints: [1000],
    fixedAmountEnabled: true,
    ownerConfigurable: true,
  });
  api.getLicensingStatus.mockResolvedValue({ mode: 'FULL' });
  api.getOrder.mockResolvedValue(sale());
  api.getRecentPrintJobs.mockResolvedValue([]);
  api.getRestaurantAdministration.mockResolvedValue(admin());
  api.getDevices.mockResolvedValue({ data: [] });
  api.getPendingPairings.mockResolvedValue({ data: [] });
  api.getInstallationReadiness.mockResolvedValue({
    productionReadiness: 'NOT_READY',
    operationalReadiness: 'READY',
    technicalHealth: 'READY',
    licensingStatus: 'FULL',
    components: [],
  });
  api.getBackupStatus.mockRejectedValue(new EdgeClientError('raw', 'PERMISSION_DENIED', 403));
  api.getTaxAdministration.mockResolvedValue({
    profiles: [],
    products: [],
    configurationVersion: 1,
    defaultTaxProfileId: null,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});
async function start() {
  render(<App />);
  await screen.findByRole('heading', { name: 'Mesa terraza' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cobrar' }).hasAttribute('disabled')).toBe(false),
  );
}

describe('POS operational presentation', () => {
  it('does not carry an add-product success into the payment dialog', async () => {
    await start();
    api.addOrderItem.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(screen.getByRole('button', { name: /Taco de prueba.*Agregar/ }));
    await screen.findByText('Taco de prueba agregado.');
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('dialog', { name: 'Registrar pago' });
    expect(screen.queryByText('Taco de prueba agregado.')).toBeNull();
    expect(api.createPayment).not.toHaveBeenCalled();
  });
  it('returns to neutral after empty cancellation without opening or selecting another sale', async () => {
    const empty = { ...sale(), orderType: 'COUNTER', tableIds: [], items: [], rounds: [], payments: [], total: money(0), balanceDue: money(0) };
    api.getOrder.mockResolvedValue(empty);
    api.cancelOrder.mockResolvedValue({ ...empty, status: 'CANCELLED', version: 8 });
    api.getOpenCounterOrders.mockResolvedValue([sale()]);
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar venta vacía' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', { name: 'Sin venta abierta' });
    expect(screen.queryByRole('dialog', { name: 'Ventas abiertas' })).toBeNull();
    expect(localStorage.getItem('comanview.pos.currentOrderId')).toBeNull();
    expect(api.cancelOrder).toHaveBeenCalledWith(id, { expectedVersion: 7, emptyCounterOnly: true });
    expect(api.createOrder).not.toHaveBeenCalled();
  });
  it.each([1013,1008])('handles WS close %s without retrying a command or renewing login',async code=>{
    await start();
    vi.useFakeTimers();
    const previous=Socket.current;
    await act(async()=>previous.onclose?.({code}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    if(code===1013){
      expect(Socket.current).not.toBe(previous);
      const reads=api.getOrder.mock.calls.length;
      await act(async()=>Socket.current.onmessage?.({data:JSON.stringify({type:'AUTHENTICATED'})}));
      expect(api.getOrder.mock.calls.length).toBeGreaterThan(reads);
      expect(localStorage.getItem('comanview.pos.sessionToken')).toBe('test-session');
    }else{
      expect(localStorage.getItem('comanview.pos.sessionToken')).toBeNull();
      expect(Socket.current).toBe(previous);
    }
    expect(api.getCurrentSession).toHaveBeenCalledTimes(1);
    expect(api.sendRound).not.toHaveBeenCalled();
    expect(api.createOrder).not.toHaveBeenCalled();
  });
  it.each(['PERSONNEL_SECURITY_UNAVAILABLE','AUTH_SESSION_INVALID'] as const)('classifies session errors by code: %s',async code=>{
    await start();api.sendRound.mockRejectedValue(new EdgeClientError('raw',code,401));
    await userEvent.click(screen.getByRole('button',{name:/Enviar ronda/}));
    await waitFor(()=>expect(api.sendRound).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(localStorage.getItem('comanview.pos.sessionToken')).toBe(code==='AUTH_SESSION_INVALID'?null:'test-session'));
  });
  it('opens cash then creates a sale and opens Devices on the first attempt without a manual refresh',async()=>{
    window.localStorage.removeItem('comanview.pos.currentOrderId');
    api.getCurrentCashSession.mockResolvedValue({session:null});
    api.openCashSession.mockResolvedValue({id,businessDate:'2026-09-13',expectedCash:null,blindCashCount:true});
    api.getBackupStatus.mockResolvedValue({recoveryState:'NORMAL',localBackupStatus:'NOT_READY',offDeviceBackupStatus:'NOT_CONFIGURED',workerStatus:'IDLE',lastSuccessfulBackup:null,lastVerifiedBackup:null,lastFailure:null,recoveryKeyAvailable:true,recoveryKeyExported:false,recoveryPreparedness:'NOT_READY',nextPeriodicBackupAt:null,recentBackups:[]});
    api.createOrder.mockResolvedValue({...sale(),orderType:'COUNTER',tableIds:[],items:[],subtotal:money(0),taxTotal:money(0),total:money(0),paidAmount:money(0),balanceDue:money(0)});
    render(<App/>);
    const open=await screen.findByRole('button',{name:/^Caja cerrada/});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Crear venta'}).matches(':disabled')).toBe(false));
    let finishOld!:(value:{session:null})=>void;
    api.getCurrentCashSession.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}));
    await userEvent.click(screen.getByRole('button',{name:/Mesas abiertas/}));
    await screen.findByRole('dialog',{name:'Mesas abiertas'});
    await waitFor(()=>expect(api.getCurrentCashSession).toHaveBeenCalledTimes(2));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(open);
    const dialog=await screen.findByRole('dialog',{name:'Abrir turno de caja'});
    await userEvent.click(within(dialog).getByRole('button',{name:'Abrir turno de caja'}));
    await screen.findByRole('button',{name:/^Caja abierta/});
    await act(async()=>{finishOld({session:null});});
    expect(screen.getByRole('button',{name:/^Caja abierta/})).toBeTruthy();
    await userEvent.click(screen.getByRole('button',{name:'Crear venta'}));
    await screen.findByText('Nueva venta creada.');
    expect(api.openCashSession).toHaveBeenCalledTimes(1);expect(api.createOrder).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button',{name:'Dispositivos y respaldo'}));
    await screen.findByRole('heading',{name:'Resumen de instalación'});
    expect(api.getDevices).toHaveBeenCalledTimes(1);expect(api.getInstallationReadiness).toHaveBeenCalledTimes(1);
  });
  it('uses shared codes and a safe fallback, without exposing server messages', () => {
    expect(getErrorMessage(new EdgeClientError('secret raw', 'UNKNOWN_EDGE_ERROR', 500))).not.toContain(
      'secret',
    );
    expect(getErrorMessage(new EdgeClientError('raw', 'CURRENCY_REQUIRED', 409))).toBe(
      getUserGuidance('CURRENCY_REQUIRED').explanation,
    );
    expect(getUserGuidance('PERMISSION_DENIED').action).toBeUndefined();
    expect(licenseModeLabel('SUSPENDED_BLOCKED')).toBe('Licencia suspendida');
  });
  it('keeps local disconnection, offline operation, degraded data and healthy connection distinct', () => {
    expect(connectionPresentation('CONNECTED', false, false).kind).toBe('offline-operational');
    expect(connectionPresentation('CONNECTED', true, true).kind).toBe('degraded');
    expect(connectionPresentation('DISCONNECTED', false, false).kind).toBe('local-unavailable');
    expect(connectionPresentation('CONNECTED', true, false).kind).toBe('connected');
    render(
      <ConnectionStatus
        connection="CONNECTED"
        networkAvailable={false}
        degraded={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('no depende de Internet');
  });
  it('associates disabled reasons and does not offer forbidden prerequisite navigation', () => {
    render(
      <>
        <PosAction disabled reason="Tu rol no permite cobrar.">
          Cobrar
        </PosAction>
        <PosFeedback
          message="Configura moneda"
          guidance={getUserGuidance('CURRENCY_REQUIRED')}
          canNavigate={() => false}
          onNavigate={vi.fn()}
        />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Cobrar' });
    expect(
      document.getElementById(button.getAttribute('aria-describedby')!)?.textContent,
    ).toContain('Tu rol');
    expect(screen.queryByRole('button', { name: 'Configurar moneda' })).toBeNull();
  });
  it('preserves the real active sale, table and drafts across Admin and Devices, restoring focus', async () => {
    await start();
    expect(screen.getByText('Propietario')).toBeTruthy();
    for (const [openerName, dialogName, closeName] of [
      ['Restaurante', 'Tu restaurante', 'Volver al POS'],
      ['Dispositivos y respaldo', 'Dispositivos e instalación', 'Cerrar administración'],
    ] as const) {
      const opener = screen.getByRole('button', { name: openerName });
      await userEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: dialogName });
      if (dialogName === 'Tu restaurante') await within(dialog).findByLabelText('Nombre comercial');
      await userEvent.click(within(dialog).getByRole('button', { name: closeName }));
      expect(document.activeElement).toBe(opener);
      expect(screen.getByRole('heading', { name: 'Mesa terraza' })).toBeTruthy();
      expect(screen.getByText(/Sin enviar · Cantidad: 1/)).toBeTruthy();
      expect(screen.getByText(/Enviado · edición protegida/)).toBeTruthy();
      expect(window.localStorage.getItem('comanview.pos.currentOrderId')).toBe(id);
    }
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(api.cancelOrder).not.toHaveBeenCalled();
    expect(api.createPayment).not.toHaveBeenCalled();
  });
  it('presents authoritative totals and separate tips, preserving the payment payload', async () => {
    await start();
    const next = sale();
    next.paidAmount = money(11600);
    next.balanceDue = money(0);
    next.version = 8;
    api.createPayment.mockResolvedValue(next);
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar pago' });
    expect(within(dialog).getAllByRole('definition')).toHaveLength(3);
    expect(
      within(dialog)
        .getAllByRole('definition')
        .map((element) => element.textContent),
    ).toEqual(['$116.00', '$16.00', '$100.00']);
    await userEvent.click(within(dialog).getByRole('button', { name: '10%' }));
    fireEvent.change(within(dialog).getByLabelText('Efectivo recibido'), {
      target: { value: '120.00' },
    });
    expect(within(dialog).getAllByText('$10.00').length).toBeGreaterThanOrEqual(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar efectivo' }));
    await waitFor(() =>
      expect(api.createPayment).toHaveBeenCalledWith(id, {
        commandId: expect.any(String),
        expectedVersion: 7,
        method: 'CASH',
        amountApplied: 10000,
        tip: { type: 'PERCENTAGE', basisPoints: 1000 },
        cashTendered: 12000,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar pago' })).toBeNull(),
    );
  });
  it('keeps the active sale when payment is dismissed and returns focus without creating a payment', async () => {
    await start();
    const opener = screen.getByRole('button', { name: 'Cobrar' });
    await userEvent.click(opener);
    fireEvent.change(screen.getByLabelText('Monto aplicado al consumo'), {
      target: { value: '40.00' },
    });
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
    expect(api.createPayment).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Mesa terraza' })).toBeTruthy();
  });
  it('does not repeat a stale command and offers review of current server state', async () => {
    await start();
    api.sendRound.mockRejectedValue(new EdgeClientError('raw private', 'STALE_ORDER_VERSION', 409));
    api.getOrder.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(screen.getByRole('button', { name: /Enviar ronda/ }));
    await screen.findByRole('button', { name: 'Consultar venta actual' });
    expect(api.sendRound).toHaveBeenCalledTimes(1);
    expect(api.sendRound).toHaveBeenCalledWith(id, {
      commandId: expect.any(String),
      expectedVersion: 7,
    });
    expect(screen.queryByText('raw private')).toBeNull();
  });
  it('distinguishes acknowledged rounds from failed printing', async () => {
    api.getRecentPrintJobs.mockResolvedValue([
      { printJobId: id, jobType: 'STATION_TICKET', status: 'FAILED', attempts: 1 },
    ]);
    await start();
    const next = sale();
    next.items = next.items.map((item) => ({ ...item, status: 'SENT' }));
    next.version = 8;
    api.sendRound.mockResolvedValue(next);
    await userEvent.click(screen.getByRole('button', { name: /Enviar ronda/ }));
    await screen.findByText(/pedido registrado/);
    expect(screen.getByText(/No repitas el envío/)).toBeTruthy();
    await userEvent.click(screen.getByText(/Revisar impresión/));
    expect(screen.getByText('No se pudo imprimir')).toBeTruthy();
    expect(api.sendRound).toHaveBeenCalledTimes(1);
  });
  it('does not describe a confirmed print request as failed when polling fails', async () => {
    await start();
    api.requestPrecheck.mockResolvedValue({ printJobId: id, status: 'PENDING' });
    api.getRecentPrintJobs.mockRejectedValue(new Error('poll failed'));
    await userEvent.click(screen.getByRole('button', { name: 'Precuenta' }));
    await screen.findByText(/Precuenta solicitado/);
    await screen.findByText('Estado de impresión sin actualizar');
    expect(api.requestPrecheck).toHaveBeenCalledWith(id, { commandId: expect.any(String) });
  });
  it('offers cash setup guidance without losing the active sale or the cash form', async () => {
    api.getCurrentCashSession.mockResolvedValue({ session: null });
    render(<App />);
    const pay = await screen.findByRole('button', { name: 'Abrir caja para cobrar' });
    await waitFor(() => expect(pay.matches(':disabled')).toBe(false));
    await userEvent.click(pay);
    const cash = await screen.findByRole('dialog', { name: 'Abrir turno de caja' });
    const input = within(cash).getByLabelText(/Fondo inicial/);
    fireEvent.change(input, { target: { value: '150.00' } });
    api.openCashSession.mockRejectedValue(
      new EdgeClientError('raw', 'DEFAULT_CASH_REGISTER_REQUIRED', 409),
    );
    await userEvent.click(within(cash).getByRole('button', { name: 'Abrir turno de caja' }));
    await userEvent.click(await within(cash).findByRole('button', { name: 'Configurar cajas' }));
    const administration = await screen.findByRole('dialog', { name: 'Tu restaurante' });
    await within(administration).findByLabelText('Nueva caja');
    await userEvent.click(within(administration).getByRole('button', { name: 'Volver al POS' }));
    expect((input as HTMLInputElement).value).toBe('150.00');
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(api.openCashSession).toHaveBeenCalledWith({
      commandId: expect.any(String),
      openingFloatAmount: 15000,
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      purpose: 'NORMAL',
    });
  });
  it('keeps permission denial distinct without retrying a rejected command', async () => {
    await start();
    api.sendRound.mockRejectedValue(new EdgeClientError('internal', 'PERMISSION_DENIED', 403));
    await userEvent.click(screen.getByRole('button', { name: /Enviar ronda/ }));
    await screen.findByText('No tienes permiso para esta acción');
    expect(api.sendRound).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Consultar venta actual' })).toBeNull();
  });
  it('refreshes a selected table without creating or cancelling sales', async () => {
    await start();
    api.getOrder.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /Mesas abiertas/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Mesas abiertas' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Mesa terraza/ }));
    await waitFor(() => expect(api.getOrder).toHaveBeenCalledWith(id));
    expect(screen.getByRole('heading', { name: 'Mesa terraza' })).toBeTruthy();
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });
  it('keeps the original add-product command and version', async () => {
    await start();
    api.addOrderItem.mockResolvedValue({ ...sale(), version: 8 });
    await userEvent.click(screen.getByRole('button', { name: /Taco de prueba.*Agregar/ }));
    await waitFor(() =>
      expect(api.addOrderItem).toHaveBeenCalledWith(id, {
        commandId: expect.any(String),
        expectedVersion: 7,
        productId,
        selectedModifierIds: [],
        specialInstructions: undefined,
      }),
    );
  });
});
