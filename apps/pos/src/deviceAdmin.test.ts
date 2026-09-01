import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import type { EdgeClient } from '@comanview/client-sdk';
import type { Device, InstallationReadiness, PairingStatusResponse } from '@comanview/contracts';
import { DeviceAdminPanel, focusPairingApproval } from './DeviceAdminPanel.js';
import { clearPairingApproval, deviceAdminErrorMessage, deviceDisplayName, deviceInstallationPresentation, effectivePairingStatus, groupPairings, loadDeviceAdminState, shouldClearPairingApproval } from './deviceAdmin.js';
import { EdgeClientError } from '@comanview/client-sdk';

describe('POS Device administration', () => {
  it('loads Devices, pairing requests and installation readiness together', async () => {
    const readiness: Awaited<ReturnType<EdgeClient['getInstallationReadiness']>> = {
      technicalHealth: 'READY',
      operationalReadiness: 'READY',
      productionReadiness: 'NOT_READY',
      licensingStatus: 'VALID',
      components: [],
    };
    const client: Pick<
      EdgeClient,
      'getDevices' | 'getPendingPairings' | 'getInstallationReadiness'
    > = {
      getDevices: vi.fn(async () => ({ data: [] })),
      getPendingPairings: vi.fn(async () => ({ data: [] })),
      getInstallationReadiness: vi.fn(async () => readiness),
    };

    await expect(loadDeviceAdminState(client)).resolves.toEqual({
      devices: [],
      pairings: [],
      readiness: expect.objectContaining({ technicalHealth: 'READY' }),
    });
    expect(client.getDevices).toHaveBeenCalledOnce();
    expect(client.getPendingPairings).toHaveBeenCalledOnce();
    expect(client.getInstallationReadiness).toHaveBeenCalledOnce();
  });

  it('renders readiness details, differentiated Devices and actionable pending pairings', () => {
    const active = device('01991a00-0000-7000-8000-000000000721', 'POS principal', 'ACTIVE');
    const revoked = device('01991a00-0000-7000-8000-000000000722', 'POS principal', 'REVOKED');
    const readiness: InstallationReadiness = {
      technicalHealth: 'READY', operationalReadiness: 'READY', productionReadiness: 'NOT_READY',
      licensingStatus: 'VALID', components: [
        { key: 'BACKUP', state: 'PENDING_PHASE', code: 'PENDING_1V', detail: 'Backup se implementará en Fase 1V.' },
      ],
    };
    const pending = pairing('01991a00-0000-7000-8000-000000000401', active, 'PENDING', '2099-08-29T12:10:00.000Z');
    const html = renderToString(createElement(DeviceAdminPanel, panelProps({
      state:{devices:[active,revoked],pairings:[pending],readiness}, currentDeviceId:active.deviceId,
    })));

    expect(html).toContain('Dispositivos e instalación');
    expect(html).toContain('Backup y recuperación');
    expect(html).toContain('Fase pendiente');
    expect(html).toContain('POS principal · POS · …000721');
    expect(html).toContain('Activo');
    expect(html).toContain('Revocado');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Aprobar emparejamiento');
  });

  it('renders an expired pairing as terminal and non-approvable', () => {
    const pendingDevice = device('01991a00-0000-7000-8000-000000000723', 'Caja barra', 'PENDING');
    const expired = pairing('01991a00-0000-7000-8000-000000000402', pendingDevice, 'PENDING', '2020-01-01T00:00:00.000Z');
    expect(effectivePairingStatus(expired, Date.parse('2020-01-02T00:00:00.000Z'))).toBe('EXPIRED');
    const html = renderToString(createElement(DeviceAdminPanel, panelProps({
      state:{devices:[pendingDevice],pairings:[expired],readiness:readiness()},
    })));
    expect(html).toContain('Expirado');
    expect(html).toContain('No completado');
    expect(html).toContain('Última solicitud expirada.');
    expect(html).toMatch(/Mostrar historial \([^)]*1[^)]*\)/);
    expect(html).toContain('Esta solicitud ya no admite acciones.');
    expect(html).not.toContain('Usar solicitud');
  });

  it('derives installation activity independently from the persisted Device status', () => {
    const pendingDevice=device('01991a00-0000-7000-8000-000000000726','KDS brave','PENDING');
    const pending=pairing('01991a00-0000-7000-8000-000000000405',pendingDevice,'PENDING','2099-01-01T00:00:00.000Z');
    const cancelled={...pending,status:'CANCELLED' as const};
    const expired={...pending,status:'EXPIRED' as const};
    expect(deviceInstallationPresentation(pendingDevice,[pending]).label).toBe('Pendiente activo');
    expect(deviceInstallationPresentation(pendingDevice,[cancelled])).toEqual(expect.objectContaining({label:'No completado',tone:'CANCELLED'}));
    expect(deviceInstallationPresentation(pendingDevice,[expired])).toEqual(expect.objectContaining({label:'No completado',tone:'EXPIRED'}));
    expect(deviceInstallationPresentation({...pendingDevice,status:'ACTIVE'},[cancelled]).label).toBe('Activo');
    expect(deviceInstallationPresentation({...pendingDevice,status:'REVOKED'},[pending]).label).toBe('Revocado');
  });

  it('prioritizes actionable pairings and keeps terminal history accessible but collapsed', () => {
    const value=device('01991a00-0000-7000-8000-000000000727','POS pruebas','PENDING');
    const terminal=Array.from({length:12},(_,index)=>pairing(`01991a00-0000-7000-8000-${String(index).padStart(12,'0')}`,value,'CANCELLED','2026-01-01T00:00:00.000Z'));
    const current=pairing('01991a00-0000-7000-8000-000000000499',value,'PENDING','2099-01-01T00:00:00.000Z');
    const grouped=groupPairings([...terminal,current]);
    expect(grouped.active.map((item)=>item.pairingId)).toEqual([current.pairingId]);
    expect(grouped.history).toHaveLength(12);
    const html=renderToString(createElement(DeviceAdminPanel,panelProps({state:{devices:[value],pairings:[...terminal,current],readiness:readiness()}})));
    expect(html.indexOf('Usar solicitud')).toBeLessThan(html.indexOf('Mostrar historial'));
    expect(html).toContain('<details class="pairing-history">');
  });

  it('keeps Device errors contextual and differentiates duplicate names without exposing full IDs', () => {
    const first=device('01991a00-0000-7000-8000-000000000721','POS principal','ACTIVE');
    const second=device('01991a00-0000-7000-8000-000000000722','POS principal','REVOKED');
    expect(deviceDisplayName(first,[first,second])).toBe('POS principal · POS · …000721');
    expect(deviceAdminErrorMessage(new EdgeClientError('raw','DEVICE_LIMIT_REACHED',409)))
      .toBe('Se alcanzó el límite de dispositivos activos para este tipo.');
  });

  it('keeps contextual feedback visible and disables pairing actions while approval is pending', () => {
    const pendingDevice = device('01991a00-0000-7000-8000-000000000724', 'Caja terraza', 'PENDING');
    const pending = pairing('01991a00-0000-7000-8000-000000000403', pendingDevice, 'PENDING', '2099-01-01T00:00:00.000Z');
    const html = renderToString(createElement(DeviceAdminPanel, panelProps({
      state:{devices:[pendingDevice],pairings:[pending],readiness:readiness()},
      error:'Se alcanzó el límite de dispositivos activos para este tipo.',
      busyAction:`approve:${pending.pairingId}`,
      approvalPairingId:pending.pairingId,
      approvalCode:'123456',
    })));

    expect(html).toContain('Se alcanzó el límite de dispositivos activos para este tipo.');
    expect(html).toContain('Aprobando…');
    expect(html).toContain('disabled=""');
  });

  it('scrolls the approval target and focuses the six-digit code respecting reduced motion',()=>{
    const form={scrollIntoView:vi.fn()};const input={focus:vi.fn()};
    focusPairingApproval(form,input,false);
    expect(form.scrollIntoView).toHaveBeenCalledWith({behavior:'smooth',block:'nearest'});
    expect(input.focus).toHaveBeenCalledWith({preventScroll:true});
    focusPairingApproval(form,input,true);
    expect(form.scrollIntoView).toHaveBeenLastCalledWith({behavior:'auto',block:'nearest'});
  });

  it('clears pairing ID and code after consumption, cancellation or authoritative expiry',()=>{
    const pendingDevice=device('01991a00-0000-7000-8000-000000000725','POS secundario','PENDING');
    const selected=pairing('01991a00-0000-7000-8000-000000000404',pendingDevice,'PENDING','2026-08-29T12:10:00.000Z');
    expect(shouldClearPairingApproval([selected],selected.pairingId,Date.parse('2026-08-29T12:05:00.000Z'))).toBe(false);
    expect(shouldClearPairingApproval([selected],selected.pairingId,Date.parse('2026-08-29T12:11:00.000Z'))).toBe(true);
    expect(shouldClearPairingApproval([{...selected,status:'CANCELLED'}],selected.pairingId)).toBe(true);
    const setId=vi.fn(),setCode=vi.fn();clearPairingApproval(setId,setCode);
    expect(setId).toHaveBeenCalledWith('');expect(setCode).toHaveBeenCalledWith('');
  });
});

function device(deviceId:string,displayName:string,status:Device['status']):Device{return {deviceId,displayName,type:'POS',status,
  createdAt:'2026-08-29T12:00:00.000Z',activatedAt:status==='ACTIVE'?'2026-08-29T12:01:00.000Z':null,
  revokedAt:status==='REVOKED'?'2026-08-29T12:02:00.000Z':null};}
function pairing(pairingId:string,value:Device,status:PairingStatusResponse['status'],expiresAt:string):PairingStatusResponse{return {pairingId,status,device:value,expiresAt};}
function readiness():InstallationReadiness{return {technicalHealth:'READY',operationalReadiness:'READY',productionReadiness:'NOT_READY',licensingStatus:'VALID',components:[]};}
function panelProps(overrides:Partial<Parameters<typeof DeviceAdminPanel>[0]>={}) { return {
  state:null,loading:false,error:null,notice:null,busyAction:null,currentDeviceId:null,canPair:true,canRevoke:true,
  approvalPairingId:'',approvalCode:'',onApprovalPairingId:vi.fn(),onApprovalCode:vi.fn(),onApprove:vi.fn(),
  onCancel:vi.fn(async()=>undefined),onRevoke:vi.fn(async()=>undefined),onRefresh:vi.fn(),onClose:vi.fn(),...overrides,
}; }
