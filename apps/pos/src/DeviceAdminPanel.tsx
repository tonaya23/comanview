import { useEffect, useMemo, useRef, useState } from 'react';
import type { Device, PairingStatusResponse } from '@comanview/contracts';
import { clearPairingApproval, deviceDisplayName, deviceInstallationPresentation, effectivePairingStatus, groupPairings, shouldClearPairingApproval, type DeviceAdminState } from './deviceAdmin.js';

type BusyAction = `approve:${string}` | `cancel:${string}` | `revoke:${string}` | 'refresh' | null;

export interface DeviceAdminPanelProps {
  state: DeviceAdminState | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  busyAction: BusyAction;
  currentDeviceId: string | null;
  canPair: boolean;
  canRevoke: boolean;
  approvalPairingId: string;
  approvalCode: string;
  onApprovalPairingId(value: string): void;
  onApprovalCode(value: string): void;
  onApprove(): void;
  onCancel(pairing: PairingStatusResponse): Promise<void>;
  onRevoke(device: Device): Promise<void>;
  onRefresh(): void;
  onClose(): void;
}

const labels: Record<string,string> = {
  READY: 'Listo', NOT_READY: 'Pendiente', DEGRADED: 'Degradado', PENDING_PHASE: 'Fase pendiente',
  NOT_APPLICABLE: 'No aplica', ACTIVE: 'Activo', PENDING: 'Pendiente', REVOKED: 'Revocado',
  EXPIRED: 'Expirado', CANCELLED: 'Cancelado', VALID: 'Válida',
};

export function DeviceAdminPanel(props: DeviceAdminPanelProps) {
  const [confirmingCancel, setConfirmingCancel] = useState<PairingStatusResponse | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<Device | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const approvalFormRef = useRef<HTMLFormElement>(null);
  const approvalCodeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const activeDevices = props.state?.devices.filter((device) => device.status === 'ACTIVE').length ?? 0;
  const pairings = useMemo(() => props.state?.pairings.map((pairing) => ({
    pairing,
    effectiveStatus: effectivePairingStatus(pairing, now),
  })) ?? [], [now, props.state]);
  const groupedPairings = useMemo(() => groupPairings(props.state?.pairings ?? [], now), [now, props.state]);
  useEffect(() => {
    if (!props.approvalPairingId) return;
    if (shouldClearPairingApproval(props.state?.pairings??[],props.approvalPairingId,now))
      clearPairingApproval(props.onApprovalPairingId,props.onApprovalCode);
  }, [pairings, props.approvalPairingId, props.onApprovalCode, props.onApprovalPairingId]);
  function usePairing(pairingId:string) {
    props.onApprovalPairingId(pairingId);
    window.requestAnimationFrame(() => focusPairingApproval(
      approvalFormRef.current,
      approvalCodeRef.current,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ));
  }

  return <div className="modal-backdrop device-admin-backdrop">
    <section className="modal-card device-admin" role="dialog" aria-modal="true" aria-labelledby="device-admin-title">
      <header className="device-admin-header">
        <div><span className="eyebrow">Administración local</span><h2 id="device-admin-title">Dispositivos e instalación</h2>
          <p>Estado operativo, solicitudes de emparejamiento y preparación de esta instalación.</p></div>
        <button type="button" className="icon-close" aria-label="Cerrar administración" autoFocus onClick={props.onClose}>×</button>
      </header>

      <div className="device-admin-feedback" aria-live="polite">
        {props.error ? <span className="inline-alert inline-alert--error">{props.error}</span>
          : props.notice ? <span className="inline-alert inline-alert--success">{props.notice}</span> : <span>&nbsp;</span>}
      </div>

      {props.loading && !props.state ? <div className="admin-loading" role="status">Cargando estado local…</div> : null}
      {props.state ? <>
        <section className="admin-section" aria-labelledby="installation-summary-title">
          <div className="section-title-row"><div><h3 id="installation-summary-title">Resumen de instalación</h3>
            <p>La preparación para producción permanece pendiente hasta completar todos los componentes requeridos.</p></div>
            <button type="button" className="secondary-button compact-button" disabled={props.busyAction === 'refresh'} onClick={props.onRefresh}>
              {props.busyAction === 'refresh' ? 'Actualizando…' : 'Actualizar'}
            </button></div>
          <div className="readiness-summary">
            <Summary label="Producción" value={props.state.readiness.productionReadiness}/>
            <Summary label="Operación" value={props.state.readiness.operationalReadiness}/>
            <Summary label="Salud técnica" value={props.state.readiness.technicalHealth}/>
            <Summary label="Licencia" value={props.state.readiness.licensingStatus}/>
            <Summary label="Dispositivos activos" value={String(activeDevices)} neutral/>
          </div>
          <div className="readiness-components">
            {props.state.readiness.components.map((component) => <div className="readiness-row" key={component.key}>
              <div><strong>{componentLabel(component.key)}</strong><small>{component.detail}</small></div>
              <StatusBadge value={component.state}/>
            </div>)}
          </div>
        </section>

        <section className="admin-section" aria-labelledby="devices-title">
          <div className="section-title-row"><div><h3 id="devices-title">Dispositivos registrados</h3>
            <p>{props.state.devices.length ? `${props.state.devices.length} dispositivos conservados en el historial local.` : 'Todavía no hay dispositivos registrados.'}</p></div></div>
          <div className="device-list">{props.state.devices.length ? props.state.devices.map((device) => {
            const installation = deviceInstallationPresentation(device, props.state!.pairings, now);
            return <article className={`device-card device-card--${installation.tone.toLowerCase()}`} key={device.deviceId}>
              <div className="device-card-main"><div className="device-icon" aria-hidden="true">{device.type.slice(0,1)}</div><div>
                <strong>{deviceDisplayName(device, props.state!.devices)}</strong>
                <span>{device.type}{device.deviceId === props.currentDeviceId ? ' · Este dispositivo' : ''}</span>
                <small>{installation.detail}</small>
              </div></div>
              <StatusBadge value={installation.tone} label={installation.label}/>
              <div className="device-card-actions">
                <details><summary>Detalles técnicos</summary><code>{device.deviceId}</code><span>Estado Device: {device.status}</span>
                  <span>Alta: {formatDate(device.createdAt)}</span>{device.activatedAt && <span>Activado: {formatDate(device.activatedAt)}</span>}
                  {device.revokedAt && <span>Revocado: {formatDate(device.revokedAt)}</span>}</details>
                {device.status === 'ACTIVE' && device.deviceId !== props.currentDeviceId && props.canRevoke ?
                  <button type="button" className="danger-button" disabled={Boolean(props.busyAction)} onClick={() => setConfirmingRevoke(device)}>Revocar</button> : null}
              </div>
            </article>;
          }) : <EmptyState text="Los dispositivos aparecerán aquí después de completar el emparejamiento."/>}</div>
        </section>

        <section className="admin-section" aria-labelledby="pairings-title">
          <div className="section-title-row"><div><h3 id="pairings-title">Solicitudes de emparejamiento</h3>
            <p>Selecciona una solicitud vigente y confirma el código que muestra el dispositivo.</p></div></div>
          <div className="pairing-list">{groupedPairings.active.length ? groupedPairings.active.map((pairing) =>
            <PairingCard key={pairing.pairingId} pairing={pairing} devices={props.state!.devices}
              selected={props.approvalPairingId===pairing.pairingId} actionable={props.canPair}
              busy={Boolean(props.busyAction)} onUse={usePairing} onCancel={setConfirmingCancel}/>)
            : <EmptyState text="No hay solicitudes activas."/>}</div>

          {props.canPair ? <form ref={approvalFormRef} className="pairing-approval" onSubmit={(event) => { event.preventDefault(); props.onApprove(); }}>
            <h4>Aprobar dispositivo</h4><p>El Pairing ID identifica la solicitud; el código de seis dígitos confirma que estás frente al dispositivo correcto.</p>
            <label>Pairing ID<input value={props.approvalPairingId} onChange={(event) => props.onApprovalPairingId(event.target.value)} placeholder="Selecciona una solicitud o pega su ID" autoComplete="off"/></label>
            <label>Código de 6 dígitos<input ref={approvalCodeRef} value={props.approvalCode} onChange={(event) => props.onApprovalCode(event.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" pattern="[0-9]{6}" placeholder="000000" autoComplete="one-time-code"/></label>
            <button className="primary-button" disabled={Boolean(props.busyAction)||!props.approvalPairingId||props.approvalCode.length!==6}>
              {props.busyAction?.startsWith('approve:') ? 'Aprobando…' : 'Aprobar emparejamiento'}
            </button>
          </form> : null}

          {groupedPairings.history.length ? <details className="pairing-history">
            <summary>Mostrar historial ({groupedPairings.history.length})</summary>
            <div className="pairing-list">{groupedPairings.history.map((pairing) => <PairingCard key={pairing.pairingId}
              pairing={pairing} devices={props.state!.devices} selected={false} actionable={false} busy={false}
              onUse={usePairing} onCancel={setConfirmingCancel}/>)}</div>
          </details> : null}
        </section>
      </> : null}

      {confirmingCancel ? <ConfirmCard title="Cancelar solicitud" confirmLabel="Cancelar emparejamiento" destructive
        busy={props.busyAction === `cancel:${confirmingCancel.pairingId}`}
        description="El dispositivo deberá generar una solicitud nueva. El historial de esta solicitud se conserva."
        onCancel={() => setConfirmingCancel(null)} onConfirm={() => void props.onCancel(confirmingCancel).then(()=>setConfirmingCancel(null))}/> : null}
      {confirmingRevoke ? <ConfirmCard title={`Revocar ${confirmingRevoke.displayName}`} confirmLabel="Revocar dispositivo" destructive
        busy={props.busyAction === `revoke:${confirmingRevoke.deviceId}`}
        description="Las sesiones activas de este dispositivo se cerrarán y deberá emparejarse nuevamente como un dispositivo nuevo."
        onCancel={() => setConfirmingRevoke(null)} onConfirm={() => void props.onRevoke(confirmingRevoke).then(()=>setConfirmingRevoke(null))}/> : null}
    </section>
  </div>;
}

export function focusPairingApproval(
  form:{scrollIntoView(options?:ScrollIntoViewOptions):void}|null,
  codeInput:{focus(options?:FocusOptions):void}|null,
  reducedMotion:boolean,
) {
  form?.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'nearest'});
  codeInput?.focus({preventScroll:true});
}

function Summary({label,value,neutral=false}:{label:string;value:string;neutral?:boolean}) { return <article className="readiness-card"><span>{label}</span>{neutral?<strong>{value}</strong>:<StatusBadge value={value}/>}</article>; }
export function StatusBadge({value,label}:{value:string;label?:string}) { return <span className={`admin-status admin-status--${value.toLowerCase()}`}>{label??labels[value]??value}</span>; }
function PairingCard(props:{pairing:PairingStatusResponse;devices:Device[];selected:boolean;actionable:boolean;busy:boolean;onUse(id:string):void;onCancel(pairing:PairingStatusResponse):void}) {
  const status=effectivePairingStatus(props.pairing);
  return <article className={`pairing-card${props.selected?' pairing-card--selected':''}`} aria-current={props.selected?'true':undefined}>
    <div><strong>{deviceDisplayName(props.pairing.device,props.devices)}</strong><span>{props.pairing.device.type} · vence {formatDate(props.pairing.expiresAt)}</span></div>
    <StatusBadge value={status}/><details><summary>Detalles técnicos</summary><code>{props.pairing.pairingId}</code><code>{props.pairing.device.deviceId}</code></details>
    {status==='PENDING'&&props.actionable?<div className="pairing-actions"><button type="button" className="secondary-button compact-button" disabled={props.busy} onClick={()=>props.onUse(props.pairing.pairingId)}>{props.selected?'Solicitud seleccionada':'Usar solicitud'}</button><button type="button" className="text-danger-button" disabled={props.busy} onClick={()=>props.onCancel(props.pairing)}>Cancelar</button></div>:<small className="terminal-help">Esta solicitud ya no admite acciones.</small>}
  </article>;
}
function EmptyState({text}:{text:string}) { return <div className="admin-empty">{text}</div>; }
function ConfirmCard(props:{title:string;description:string;confirmLabel:string;destructive?:boolean;busy:boolean;onCancel():void;onConfirm():void}) { return <div className="confirmation-scrim"><section className="confirmation-card" role="alertdialog" aria-modal="true" aria-labelledby="device-confirmation-title"><h3 id="device-confirmation-title">{props.title}</h3><p>{props.description}</p><div><button type="button" className="secondary-button" disabled={props.busy} onClick={props.onCancel}>Volver</button><button type="button" className={props.destructive?'danger-button':'primary-button'} disabled={props.busy} onClick={props.onConfirm}>{props.busy?'Procesando…':props.confirmLabel}</button></div></section></div>; }
function componentLabel(key:string) { return ({EDGE:'Edge local',DATABASE:'Base de datos',TENANT_LOCATION:'Tenant y Location',LICENSE:'Licencia',CATALOG:'Catálogo',USERS:'Usuarios',RBAC:'Permisos locales',CASH_REGISTER:'Caja',STATIONS:'Estaciones KDS',PRINTING:'Impresión',DEVICES:'Dispositivos',BOOTSTRAP:'Instalación inicial',SYNC:'Sincronización',BACKUP:'Backup y recuperación'} as Record<string,string>)[key]??key; }
function formatDate(value:string) { return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
