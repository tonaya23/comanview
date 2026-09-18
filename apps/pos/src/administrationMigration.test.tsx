// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act,renderHook,cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import { RestaurantAdministrationStateSchema } from '@comanview/contracts';
import type { TaxAdministrationState } from '@comanview/contracts';
import { AdministrationPanel } from './AdministrationPanel.js';
import {
  AdministrationDraftStore,
  AdministrationResources,
  resolveAdminTarget,
  canOpenAdminSection,
} from './administrationModel.js';
import { StationFunctionField, AdministrationEditDialog } from './AdministrationDialogs.js';
import { useAdministrationController } from './useAdministrationController.js';

afterEach(cleanup);
const permissions = [
  'ADMINISTRATION_VIEW',
  'PERSONNEL_VIEW',
  'CATALOG_VIEW',
  'DEVICE_VIEW',
  'BUSINESS_PROFILE_MANAGE',
  'BUSINESS_DAY_POLICY_MANAGE',
  'CURRENCY_MANAGE',
  'CASH_REGISTER_MANAGE',
  'STATION_MANAGE',
  'TABLE_MANAGE',
  'TAX_PROFILE_MANAGE',
];
function fixture() {
  return RestaurantAdministrationStateSchema.parse({
    businessProfile: {
      commercialName: 'Restaurante',
      legalName: null,
      phone: null,
      email: null,
      address: {},
      operatingHours: [],
      logo: null,
      confirmed: true,
      version: 1,
    },
    operational: {
      timeZone: 'America/Matamoros',
      rollover: '04:00',
      businessDayVersion: 1,
      currency: 'MXN',
      currencyLocked: false,
      defaultCashRegisterId: null,
      defaultTaxProfileId: null,
      fiscalPolicyVersion: 1,
      tipPreferences: null,
      version: 1,
    },
    cashRegisters: [],
    stations: [],
    zones: [],
    tables: [],
  });
}
function client() {
  return {
    getRestaurantAdministration: vi.fn(async () => fixture()),
    getTaxAdministration: vi.fn(async () => ({
      profiles: [] as TaxAdministrationState['profiles'],
      products: [],
      defaultTaxProfileId: null,
      configurationVersion: 1,
    })),
    getPersonnel: vi.fn(async () => ({ users: [], ownerRecoveryRequired: false })),
    getProducts: vi.fn(async () => []),
    getEdgeConfiguration: vi.fn(async () => ({ payment: { tipPercentageOptionsBasisPoints: [] } })),
    executeRestaurantAdministration: vi.fn(async () => ({ entityId: 'id', version: 2 })),
    executeTaxAdministration: vi.fn(),
    executePersonnel: vi.fn(),
    catalogCommand: vi.fn(),
  };
}
async function open(
  mock = client(),
  extra: Partial<React.ComponentProps<typeof AdministrationPanel>> = {},
) {
  const onClose = vi.fn(),
    onNavigate = vi.fn();
  render(
    <AdministrationPanel
      edge={mock as unknown as EdgeClient}
      currentUserId="owner"
      permissions={permissions}
      onClose={onClose}
      onNavigate={onNavigate}
      {...extra}
    />,
  );
  await screen.findByLabelText('Nombre comercial');
  return { mock, onClose, onNavigate };
}
const navigation = () =>
  within(screen.getByRole('navigation', { name: 'Administración del restaurante' }));

describe('Admin Local section lifecycle', () => {
  it('retains authoritative Station ACK/version when the follow-up read fails, without losing another draft',async()=>{
    const productId=crypto.randomUUID(),profileId=crypto.randomUUID(),stationId=crypto.randomUUID();
    const tax:TaxAdministrationState={fiscalPolicyVersion:1,configurationVersion:1,defaultTaxProfileId:profileId,profiles:[],products:[{id:productId,name:'Product',taxProfileId:profileId,taxProfileRevision:1,version:5}]};
    const mock={...client(),getTaxAdministration:vi.fn(async()=>tax)};
    const {result}=renderHook(()=>useAdministrationController({edge:mock as unknown as EdgeClient,currentUserId:'owner',permissions,onClose:vi.fn(),initialTarget:{surface:'administration',section:'stations'}}));
    await waitFor(()=>expect(result.current.loaded).toBe(true));
    act(()=>{result.current.setAssignment({productId,stationId,version:5,stationVersion:2});result.current.choose('other-draft','old',3,'keep');});
    mock.getTaxAdministration.mockRejectedValueOnce(new EdgeClientError('Offline','EDGE_UNREACHABLE',0));
    await act(async()=>{await result.current.run(async()=>({entityId:productId,version:6,catalogGeneration:20,changed:true,recoveryEpoch:0,reference:{kind:'STATION',id:stationId,version:2}}),'Saved','assignment');});
    expect(result.current.assignment).toMatchObject({productId,stationId,version:6});
    expect(result.current.tax?.products[0]?.version).toBe(6);
    expect(result.current.choices['other-draft']).toMatchObject({value:'keep',version:3});
    expect(result.current.reconciliationPending).toBe(true);
  });
  it('preserves captured Tax reference/Product versions on OCC and stores a successful Tax ACK',async()=>{
    const productId=crypto.randomUUID(),profileId=crypto.randomUUID(),other=crypto.randomUUID(),key=`choice:product:${productId}`;
    const tax:TaxAdministrationState={fiscalPolicyVersion:1,configurationVersion:1,defaultTaxProfileId:profileId,profiles:[],products:[{id:productId,name:'Product',taxProfileId:profileId,taxProfileRevision:1,version:5}]};
    const mock={...client(),getTaxAdministration:vi.fn(async()=>tax)};
    const {result}=renderHook(()=>useAdministrationController({edge:mock as unknown as EdgeClient,currentUserId:'owner',permissions,onClose:vi.fn(),initialTarget:{surface:'administration',section:'taxes'}}));
    await waitFor(()=>expect(result.current.loaded).toBe(true));
    act(()=>result.current.choose(key,profileId,5,other,3));
    const intent={productId,expectedVersion:5,profileId:other,profileVersion:3};
    const attempt=result.current.assignmentCommandId(key,intent);
    await act(async()=>{await result.current.run(async()=>{throw new EdgeClientError('Stale','CATALOG_VERSION_CONFLICT',409);},'Saved',key);});
    expect(result.current.choices[key]).toEqual({value:other,version:5,referenceVersion:3});
    expect(result.current.conflict).toBe(true);
    expect(result.current.assignmentCommandId(key,intent)).toBe(attempt);
    mock.getTaxAdministration.mockRejectedValueOnce(new EdgeClientError('Offline','EDGE_UNREACHABLE',0));
    await act(async()=>{await result.current.run(async()=>({entityId:productId,version:6,catalogGeneration:20,changed:true,recoveryEpoch:0,reference:{kind:'TAX_PROFILE',id:other,version:3}}),'Saved',key);});
    expect(result.current.tax?.products[0]).toMatchObject({version:6,taxProfileId:other,taxProfileRevision:3});
    expect(result.current.choices[key]).toBeUndefined();
    expect(result.current.assignmentCommandId(key,intent)).not.toBe(attempt);
  });
  it('creates through catalog commands and reuses identity when an ACK is lost',async()=>{
    const mock=client(),profileId='01991a00-0000-7000-8000-000000000711';
    mock.getTaxAdministration.mockResolvedValue({profiles:[{id:profileId,name:'IVA',rateBasisPoints:800,calculationMode:'TAX_ADDED',active:true,version:1}],products:[],defaultTaxProfileId:null,configurationVersion:1});
    mock.catalogCommand.mockRejectedValueOnce(new EdgeClientError('Lost ACK','EDGE_UNREACHABLE',0)).mockResolvedValue({changed:true});
    await open(mock);await userEvent.click(navigation().getByRole('button',{name:/Impuestos/}));
    fireEvent.change(await screen.findByLabelText('Nombre del producto'),{target:{value:'Coffee'}});
    fireEvent.change(screen.getByLabelText('Precio (MXN)'),{target:{value:'100.00'}});
    fireEvent.change(screen.getByLabelText('Perfil fiscal del producto'),{target:{value:profileId}});
    await userEvent.click(screen.getByRole('button',{name:'Crear producto'}));
    await waitFor(()=>expect(mock.catalogCommand).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Crear producto'}) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button',{name:'Crear producto'}));
    await waitFor(()=>expect(mock.catalogCommand).toHaveBeenCalledTimes(2));
    expect(mock.catalogCommand.mock.calls[0]?.[0]).toEqual(mock.catalogCommand.mock.calls[1]?.[0]);
    expect(mock.catalogCommand.mock.calls[0]?.[0]).toMatchObject({kind:'CREATE_PRODUCT',expectedVersion:0,payload:{basePrice:{amount:10000,currency:'MXN'}}});
  });
  it('does not retry a confirmed mutation when reconciliation fails, and resumes only after an authoritative read',async()=>{
    const mock=client();await open(mock);
    fireEvent.change(screen.getByLabelText('Nombre comercial'),{target:{value:'Confirmado'}});
    mock.getRestaurantAdministration.mockRejectedValueOnce(new EdgeClientError('raw','EDGE_UNREACHABLE',0));
    await userEvent.click(screen.getByRole('button',{name:'Guardar perfil'}));
    await screen.findByText('Guardado confirmado; consulta pendiente');
    fireEvent.click(screen.getByRole('button',{name:'Guardar perfil'}));
    expect(mock.executeRestaurantAdministration).toHaveBeenCalledTimes(1);
    const next=fixture();next.businessProfile.version=2;next.businessProfile.commercialName='Confirmado';
    mock.getRestaurantAdministration.mockResolvedValue(next);
    await userEvent.click(screen.getByRole('button',{name:'Consultar guardado'}));
    await waitFor(()=>expect(screen.queryByText('Guardado confirmado; consulta pendiente')).toBeNull());
    expect((screen.getByLabelText('Nombre comercial') as HTMLInputElement).value).toBe('Confirmado');
    expect(mock.executeRestaurantAdministration).toHaveBeenCalledTimes(1);
  });
  it('uses the authoritative version from day-save reconciliation for the immediate currency command',async()=>{
    const mock=client();await open(mock);
    await userEvent.click(navigation().getByRole('button',{name:/Día y moneda/}));
    fireEvent.change(await screen.findByLabelText(/Hora de inicio/),{target:{value:'06:00'}});
    const updated=fixture();updated.operational.version=2;updated.operational.rollover='06:00';
    mock.getRestaurantAdministration.mockResolvedValue(updated);
    await userEvent.click(screen.getByRole('button',{name:'Guardar día de negocio'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Establecer moneda'}).matches(':disabled')).toBe(false));
    await userEvent.click(screen.getByRole('button',{name:'Establecer moneda'}));
    await waitFor(()=>expect(mock.executeRestaurantAdministration).toHaveBeenCalledTimes(2));
    expect(mock.executeRestaurantAdministration).toHaveBeenLastCalledWith(expect.objectContaining({kind:'SET_CURRENCY',expectedVersion:2,currency:'MXN'}));
  });
  it('never republishes a pre-ACK request into the invalidated resource cache',async()=>{
    const mock=client(),cache=new AdministrationResources();
    let resolveOld!:(value:ReturnType<typeof fixture>)=>void;
    mock.getRestaurantAdministration.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
    const old=cache.load(mock as unknown as EdgeClient,'business-profile',permissions);
    cache.invalidate();
    const latest=fixture();latest.operational.version=7;
    mock.getRestaurantAdministration.mockResolvedValue(latest);
    const current=await cache.load(mock as unknown as EdgeClient,'business-profile',permissions);
    expect(current).toMatchObject({resources:{admin:{status:'ready',value:latest}}});
    resolveOld(fixture());await old;
    expect(await cache.load(mock as unknown as EdgeClient,'registers',permissions)).toMatchObject({resources:{admin:{status:'ready',value:latest}}});
    expect(mock.getRestaurantAdministration).toHaveBeenCalledTimes(2);
  });
  it('clears dirty state when an edit returns exactly to its baseline',()=>{
    const drafts=new AdministrationDraftStore();
    drafts.observe('currency','day-currency','MXN',1);drafts.mark('currency');
    drafts.observe('currency','day-currency','USD',1);expect(drafts.dirty).toBe(true);
    drafts.observe('currency','day-currency','MXN',1);expect(drafts.dirty).toBe(false);
  });
  it('submits ENROLL once without status and keeps PIN masked then clears it after ACK',async()=>{
    const mock=client();mock.executePersonnel.mockResolvedValue({});
    await open(mock,{permissions:[...permissions,'PERSONNEL_MANAGE']});
    await userEvent.click(navigation().getByRole('button',{name:'Personal'}));
    const pin=await screen.findByLabelText(/PIN/);
    expect(pin.getAttribute('type')).toBe('password');
    fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'Persona nueva'}});
    fireEvent.change(pin,{target:{value:'5432'}});
    await userEvent.click(screen.getByRole('button',{name:'Crear persona'}));
    await waitFor(()=>expect(mock.executePersonnel).toHaveBeenCalledTimes(1));
    expect(mock.executePersonnel.mock.calls[0]![0]).not.toHaveProperty('status');
    await waitFor(()=>expect((pin as HTMLInputElement).value).toBe(''));
  });
  it('keeps an OCC warning after saving another section and rebases only by explicit confirmation', async () => {
    const mock = client();
    mock.executeRestaurantAdministration.mockRejectedValueOnce(
      new EdgeClientError('raw', 'ADMINISTRATION_VERSION_CONFLICT', 409),
    );
    await open(mock);
    fireEvent.change(screen.getByLabelText('Nombre comercial'), { target: { value: 'Intención' } });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByRole('button', { name: 'Consultar estado actual' });
    await userEvent.click(navigation().getByRole('button', { name: /Día y moneda/ }));
    fireEvent.change(await screen.findByLabelText(/Hora de inicio/), {
      target: { value: '05:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar día de negocio' }));
    await waitFor(() => expect(mock.executeRestaurantAdministration).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        navigation()
          .getByRole('button', { name: /Negocio/ })
          .hasAttribute('disabled'),
      ).toBe(false),
    );
    await userEvent.click(navigation().getByRole('button', { name: /Negocio/ }));
    const latest = fixture();
    latest.businessProfile.version = 4;
    mock.getRestaurantAdministration.mockResolvedValue(latest);
    await userEvent.click(await screen.findByRole('button', { name: 'Consultar estado actual' }));
    const rebase = screen.getByRole('button', { name: 'Usar la base consultada' });
    await waitFor(() => expect(rebase.hasAttribute('disabled')).toBe(false));
    await userEvent.click(rebase);
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Confirma antes de continuar' })).getByRole(
        'button',
        { name: 'Continuar' },
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await waitFor(() =>
      expect(mock.executeRestaurantAdministration).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedVersion: 4, commercialName: 'Intención' }),
      ),
    );
  });
  it('isolates a failed tax resource and keeps read-only personnel accessible', async () => {
    const mock = client();
    mock.getTaxAdministration.mockRejectedValue(
      new EdgeClientError('raw', 'PERMISSION_DENIED', 403),
    );
    await open(mock, { permissions: ['ADMINISTRATION_VIEW', 'PERSONNEL_VIEW'] });
    expect(screen.getByLabelText('Nombre comercial').matches(':disabled')).toBe(true);
    await userEvent.click(navigation().getByRole('button', { name: 'Impuestos' }));
    await screen.findByRole('button', { name: 'Reintentar' });
    await userEvent.click(navigation().getByRole('button', { name: 'Personal' }));
    expect(
      (await screen.findByRole('button', { name: 'Crear persona' })).matches(':disabled'),
    ).toBe(true);
    expect(mock.getPersonnel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
  it('preserves table selection drafts and the original version until an explicit save', async () => {
    const mock = client(),
      data = fixture();
    const zoneA = '11111111-1111-4111-8111-111111111111',
      zoneB = '22222222-2222-4222-8222-222222222222',
      tableId = '33333333-3333-4333-8333-333333333333';
    data.zones = [
      { id: zoneA, name: 'Salón', active: true, displayOrder: 0, version: 1 },
      { id: zoneB, name: 'Terraza', active: true, displayOrder: 1, version: 1 },
    ];
    data.tables = [
      {
        id: tableId,
        zoneId: zoneA,
        name: 'Mesa uno',
        capacity: 4,
        active: true,
        displayOrder: 0,
        version: 3,
      },
    ];
    mock.getRestaurantAdministration.mockResolvedValue(data);
    await open(mock);
    await userEvent.click(navigation().getByRole('button', { name: 'Zonas y mesas' }));
    fireEvent.change(await screen.findByLabelText('Zona de Mesa uno'), {
      target: { value: zoneB },
    });
    expect(mock.executeRestaurantAdministration).not.toHaveBeenCalled();
    await userEvent.click(navigation().getByRole('button', { name: /Negocio/ }));
    await screen.findByLabelText('Nombre comercial');
    await userEvent.click(navigation().getByRole('button', { name: /Zonas y mesas/ }));
    expect(((await screen.findByLabelText('Zona de Mesa uno')) as HTMLSelectElement).value).toBe(
      zoneB,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar zona de Mesa uno' }));
    await waitFor(() =>
      expect(mock.executeRestaurantAdministration).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'UPDATE_TABLE',
          tableId,
          zoneId: zoneB,
          expectedVersion: 3,
        }),
      ),
    );
  });
  it('restores focus to the row after cancelling a nested edit without closing Admin', async () => {
    const mock = client(),
      data = fixture();
    data.cashRegisters = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Caja A',
        active: true,
        currency: 'MXN',
        blindCashCount: true,
        displayOrder: 0,
        version: 1,
      },
    ];
    mock.getRestaurantAdministration.mockResolvedValue(data);
    const { onClose } = await open(mock);
    await userEvent.click(navigation().getByRole('button', { name: 'Cajas' }));
    const rename = await screen.findByRole('button', { name: 'Renombrar' });
    await userEvent.click(rename);
    const editor = await screen.findByRole('textbox', { name: 'Nombre de caja' });
    editor.focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Nombre de caja' })).toBeNull();
    expect(document.activeElement).toBe(rename);
  });
  it('keeps a failed row edit visible when an unrelated draft is saved', async () => {
    const mock = client(),
      data = fixture();
    data.cashRegisters = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Caja A',
        active: true,
        currency: 'MXN',
        blindCashCount: true,
        displayOrder: 0,
        version: 1,
      },
    ];
    mock.getRestaurantAdministration.mockResolvedValue(data);
    mock.executeRestaurantAdministration.mockRejectedValueOnce(
      new EdgeClientError('raw', 'ADMINISTRATION_VERSION_CONFLICT', 409),
    );
    await open(mock);
    await userEvent.click(navigation().getByRole('button', { name: 'Cajas' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Renombrar' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Nombre de caja' }), {
      target: { value: 'Mi intención' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }));
    await screen.findByText('Edición pendiente');
    await userEvent.click(navigation().getByRole('button', { name: /Negocio/ }));
    fireEvent.change(await screen.findByLabelText('Nombre comercial'), {
      target: { value: 'Guardado independiente' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByText('Perfil confirmado.');
    expect(screen.getByText(/Nombre de caja: Mi intención/)).toBeTruthy();
  });
  it('loads readiness only on request and resolves its station action locally', async () => {
    const mock = {
      ...client(),
      getInstallationReadiness: vi.fn(async () => ({
        technicalHealth: 'READY',
        operationalReadiness: 'NOT_READY',
        productionReadiness: 'NOT_READY',
        licensingStatus: 'FULL',
        components: [
          { key: 'STATIONS', state: 'NOT_READY', code: 'STATIONS_MISSING', detail: 'internal' },
        ],
      })),
    };
    await open(mock);
    expect(mock.getInstallationReadiness).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Consultar preparación completa' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Configurar estaciones' }));
    await screen.findByLabelText('Función de estación');
    expect(mock.getInstallationReadiness).toHaveBeenCalledTimes(1);
  });
  it('loads and mounts only the active section, reuses resources, and retains multiple drafts', async () => {
    const { mock } = await open();
    expect(mock.getPersonnel).not.toHaveBeenCalled();
    expect(mock.getTaxAdministration).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Nueva caja')).toBeNull();
    fireEvent.change(screen.getByLabelText('Nombre comercial'), {
      target: { value: 'Nombre pendiente' },
    });
    await userEvent.click(navigation().getByRole('button', { name: /Día y moneda/ }));
    const time = await screen.findByLabelText(/Hora de inicio/);
    fireEvent.change(time, { target: { value: '05:30' } });
    expect(screen.queryByLabelText('Nombre comercial')).toBeNull();
    await userEvent.click(navigation().getByRole('button', { name: /Negocio/ }));
    expect(((await screen.findByLabelText('Nombre comercial')) as HTMLInputElement).value).toBe(
      'Nombre pendiente',
    );
    await userEvent.click(navigation().getByRole('button', { name: /Día y moneda/ }));
    expect(((await screen.findByLabelText(/Hora de inicio/)) as HTMLInputElement).value).toBe(
      '05:30',
    );
    expect(mock.getRestaurantAdministration).toHaveBeenCalledTimes(1);
  });
  it('saving day keeps the business draft and authoritative reload never overwrites it', async () => {
    const { mock } = await open();
    fireEvent.change(screen.getByLabelText('Nombre comercial'), {
      target: { value: 'Borrador local' },
    });
    await userEvent.click(navigation().getByRole('button', { name: /Día y moneda/ }));
    fireEvent.change(await screen.findByLabelText(/Hora de inicio/), {
      target: { value: '06:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar día de negocio' }));
    await waitFor(() =>
      expect(mock.executeRestaurantAdministration).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'SET_BUSINESS_DAY_POLICY',
          expectedVersion: 1,
          rollover: '06:00',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        navigation().getByRole('button', { name: /Negocio/ }).hasAttribute('disabled'),
      ).toBe(false),
    );
    await userEvent.click(navigation().getByRole('button', { name: /Negocio/ }));
    expect(((await screen.findByLabelText('Nombre comercial')) as HTMLInputElement).value).toBe(
      'Borrador local',
    );
    expect(screen.queryByRole('button', { name: 'Actualizar sección' })).toBeNull();
    expect(mock.getRestaurantAdministration).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText('Nombre comercial') as HTMLInputElement).value).toBe(
      'Borrador local',
    );
  });
  it('warns on dirty close and system navigation, allowing cancellation', async () => {
    const { onClose, onNavigate } = await open();
    fireEvent.change(screen.getByLabelText('Nombre comercial'), {
      target: { value: 'Sin guardar' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Volver al POS' }));
    let dialog = await screen.findByRole('dialog', { name: 'Confirma antes de continuar' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(navigation().getByRole('button', { name: 'Estado de instalación' }));
    dialog = await screen.findByRole('dialog', { name: 'Confirma antes de continuar' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    expect(onNavigate).toHaveBeenCalledWith({ surface: 'system', section: 'readiness' });
  });
  it('preserves draft intent and its original OCC revision until explicit review', async () => {
    const mock = client();
    mock.executeRestaurantAdministration.mockRejectedValue(
      new EdgeClientError('private', 'ADMINISTRATION_VERSION_CONFLICT', 409),
    );
    await open(mock);
    fireEvent.change(screen.getByLabelText('Nombre comercial'), {
      target: { value: 'Intención local' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByRole('button', { name: 'Consultar estado actual' });
    const latest = fixture();
    latest.businessProfile.version = 4;
    latest.businessProfile.commercialName = 'Cambio remoto';
    mock.getRestaurantAdministration.mockResolvedValue(latest);
    await userEvent.click(screen.getByRole('button', { name: 'Consultar estado actual' }));
    await waitFor(() => expect(mock.getRestaurantAdministration).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Nombre comercial') as HTMLInputElement).value).toBe(
      'Intención local',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    expect(mock.executeRestaurantAdministration).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 1, commercialName: 'Intención local' }),
    );
  });
  it('never loads forbidden sections and permits Personnel alone', async () => {
    const mock = client();
    render(
      <AdministrationPanel
        edge={mock as unknown as EdgeClient}
        currentUserId="owner"
        permissions={['PERSONNEL_VIEW']}
        initialTarget={{ surface: 'administration', section: 'taxes' }}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole('button', { name: 'Crear persona' });
    expect(mock.getPersonnel).toHaveBeenCalledTimes(1);
    expect(mock.getRestaurantAdministration).not.toHaveBeenCalled();
    expect(mock.getTaxAdministration).not.toHaveBeenCalled();
    expect(navigation().queryByRole('button', { name: 'Impuestos' })).toBeNull();
  });
  it('restores focus and leaves POS context intact when Admin closes', async () => {
    const mock = client();
    function Harness() {
      const [opened, setOpened] = useState(false);
      return (
        <>
          <p>Venta vigente: 324 MXN</p>
          <button onClick={() => setOpened(true)}>Abrir restaurante</button>
          {opened && (
            <AdministrationPanel
              edge={mock as unknown as EdgeClient}
              permissions={permissions}
              currentUserId="owner"
              onClose={() => setOpened(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir restaurante' });
    await userEvent.click(opener);
    await screen.findByLabelText('Nombre comercial');
    await userEvent.click(screen.getByRole('button', { name: 'Volver al POS' }));
    expect(screen.getByText('Venta vigente: 324 MXN')).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });
});

describe('draft and navigation models', () => {
  it('preserves dirty baseline, saving metadata and conflict independently', () => {
    const store = new AdministrationDraftStore();
    store.observe('profile', 'business-profile', { name: 'A' }, 1);
    store.mark('profile');
    store.observe('profile', 'business-profile', { name: 'B' }, 7);
    store.conflict('profile');
    store.saving('profile', true);
    store.observe('currency', 'day-currency', 'MXN', 1);
    store.mark('currency');
    store.saved('currency');
    expect(store.get('profile')).toEqual({
      section: 'business-profile',
      initial: { name: 'A' },
      current: { name: 'B' },
      baselineRevision: 1,
      dirty: true,
      conflict: true,
      saving: true,
    });
    const apply = vi.fn();
    store.refresh('profile', apply);
    expect(apply).not.toHaveBeenCalled();
    expect(store.dirty).toBe(true);
    store.rebase('profile', 7);
    expect(store.get('profile')).toMatchObject({
      baselineRevision: 7,
      dirty: true,
      conflict: false,
      current: { name: 'B' },
    });
  });
  it('resolves typed targets with permissions before resource loading', async () => {
    expect(
      resolveAdminTarget({ surface: 'administration', section: 'taxes' }, ['ADMINISTRATION_VIEW']),
    ).toBe('taxes');
    expect(
      resolveAdminTarget({ surface: 'administration', section: 'taxes' }, ['PERSONNEL_VIEW']),
    ).toBeNull();
    expect(canOpenAdminSection('personnel', ['PERSONNEL_VIEW'])).toBe(true);
    const mock = client();
    expect(
      (await new AdministrationResources().load(mock as unknown as EdgeClient, 'taxes', [])).denied,
    ).toBe(true);
    expect(mock.getTaxAdministration).not.toHaveBeenCalled();
  });
});

describe('guided station functions and edit dialogs', () => {
  it('accepts a custom station purpose without closing the domain vocabulary', async () => {
    function Harness() {
      const [value, setValue] = useState('KITCHEN');
      return <StationFunctionField value={value} onChange={setValue} />;
    }
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText('Función de estación'), 'custom');
    fireEvent.change(screen.getByLabelText('Función personalizada'), {
      target: { value: 'PANADERIA_LOCAL' },
    });
    expect((screen.getByLabelText('Función personalizada') as HTMLInputElement).value).toBe(
      'PANADERIA_LOCAL',
    );
  });
  it('retains signed integer ordering supported by the existing domain', async () => {
    const finish = vi.fn();
    render(
      <AdministrationEditDialog
        request={{ label: 'Orden de caja', initial: '-2', resolve: vi.fn() }}
        onFinish={finish}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }));
    expect(finish).toHaveBeenCalledWith('-2');
  });
  it.each(['KITCHEN', 'BAR', 'MY_LEGACY_PURPOSE'])('preserves preset/custom/legacy %s', (value) => {
    render(<StationFunctionField value={value} onChange={vi.fn()} />);
    if (value === 'MY_LEGACY_PURPOSE')
      expect((screen.getByLabelText('Función personalizada') as HTMLInputElement).value).toBe(
        value,
      );
    else
      expect((screen.getByLabelText('Función de estación') as HTMLSelectElement).value).toBe(value);
  });
  it('offers custom input and validates edits accessibly', async () => {
    const finish = vi.fn();
    render(
      <AdministrationEditDialog
        request={{ label: 'Nombre de caja', initial: '', resolve: vi.fn() }}
        onFinish={finish}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }));
    expect(
      screen.getByRole('textbox', { name: 'Nombre de caja' }).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Completa este campo.');
    expect(finish).not.toHaveBeenCalled();
  });
});
