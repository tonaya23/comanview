import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackupTrigger, Device, PairingStatusResponse } from '@comanview/contracts';
import { Dialog, ConfirmationDialog, IconButton, PrerequisiteNotice, StatusBadge as SharedStatusBadge, TechnicalDetails, type TypedNavigationTarget } from '@comanview/ui';
import { clearPairingApproval, deviceDisplayName, deviceInstallationPresentation, effectivePairingStatus, groupPairings, readinessPrerequisite, shouldClearPairingApproval, type DeviceAdminState } from './deviceAdmin.js';

type BusyAction = `approve:${string}` | `cancel:${string}` | `revoke:${string}` | 'refresh' | 'backup-local' | 'backup-off-device' | 'backup-config' | 'recovery-key' | 'restore' | null;

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
  onCreateBackup(destination:'LOCAL'|'OFF_DEVICE'):Promise<void>;
  onConfigureOffDevice(path:string):Promise<void>;
  onExportRecoveryKey():Promise<string>;
  onRestoreBackup(backupId:string):Promise<void>;
  onNavigate?(target:TypedNavigationTarget):void;
  canNavigate?(target:TypedNavigationTarget):boolean;
  onClose(): void;
}

const labels: Record<string,string> = {
  READY: 'Listo', NOT_READY: 'Pendiente', DEGRADED: 'Degradado', PENDING_PHASE: 'Fase pendiente',
  NOT_APPLICABLE: 'No aplica', ACTIVE: 'Activo', PENDING: 'Pendiente', REVOKED: 'Revocado',
  EXPIRED: 'Expirado', CANCELLED: 'Cancelado', VALID: 'Válida',
  NORMAL:'Normal',RECOVERY_REQUIRED:'Recuperación requerida',RECOVERY_IN_PROGRESS:'Recuperando',
  NOT_CONFIGURED:'Sin configurar',VERIFIED:'Verificado',FAILED:'Falló',CREATING:'Creando',DELETED:'Eliminado',
};
const backupTriggerLabels: Record<BackupTrigger, string> = {
  MANUAL: 'Manual', PERIODIC: 'Programada', POST_Z: 'Cierre de turno',
  PRE_MAINTENANCE: 'Antes de mantenimiento', SAFETY: 'Copia de seguridad previa',
};

export function DeviceAdminPanel(props: DeviceAdminPanelProps) {
  const [confirmingCancel, setConfirmingCancel] = useState<PairingStatusResponse | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<Device | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [offDevicePath,setOffDevicePath]=useState('');
  const [exportedRecoveryKey,setExportedRecoveryKey]=useState<string|null>(null);
  const [restoreBackupId,setRestoreBackupId]=useState<string|null>(null);
  const approvalFormRef = useRef<HTMLFormElement>(null);
  const approvalCodeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const activeDevices = props.state?.devices.filter((device) => device.status === 'ACTIVE').length ?? 0;
  const requirements = props.state?.readiness.components.map(component => ({component,
    requirement:readinessPrerequisite(component,props.canNavigate??(()=>false))})) ?? [];
  const pendingRequirements = requirements.filter(row=>row.requirement.status !== 'complete' && row.component.state !== 'NOT_APPLICABLE');
  const checkedRequirements = requirements.filter(row=>!pendingRequirements.includes(row));
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

  return <Dialog open title="Dispositivos e instalación" className="device-admin pos-device-dialog" cancelable={!props.busyAction && !confirmingCancel && !confirmingRevoke && !restoreBackupId} onClose={props.onClose}>
      <header className="device-admin-header">
        <div><span className="eyebrow">Administración local</span>
          <p>Estado operativo, solicitudes de emparejamiento y preparación de esta instalación.</p></div>
        <IconButton type="button" variant="ghost" className="icon-close" aria-label="Cerrar administración" autoFocus onClick={props.onClose}>×</IconButton>
      </header>

      <div className="device-admin-feedback" aria-live="polite">
        {props.error ? <span className="inline-alert inline-alert--error">{props.error}</span>
          : props.notice ? <span className="inline-alert inline-alert--success">{props.notice}</span> : <span>&nbsp;</span>}
      </div>

      {props.loading && !props.state ? <div className="admin-loading" role="status">Cargando estado local…</div> : null}
      {props.state ? <>
        <section className="admin-section" aria-labelledby="installation-summary-title">
          <div className="section-title-row"><div><h3 id="installation-summary-title">Resumen de instalación</h3>
            <p>{props.state.readiness.productionReadiness === 'READY' ? 'Preparación para producción verificada.' : `${pendingRequirements.length} requisitos necesitan atención. Revisa primero los pendientes.`}</p></div>
            <button type="button" className="secondary-button compact-button" disabled={props.busyAction === 'refresh'} onClick={props.onRefresh}>
              {props.busyAction === 'refresh' ? 'Actualizando…' : 'Actualizar'}
            </button></div>
          <details className="readiness-technical"><summary>Estado general y detalles de instalación</summary><div className="readiness-summary">
            <Summary label="Producción" value={props.state.readiness.productionReadiness}/>
            <Summary label="Operación" value={props.state.readiness.operationalReadiness}/>
            <Summary label="Salud técnica" value={props.state.readiness.technicalHealth}/>
            <Summary label="Licencia" value={props.state.readiness.licensingStatus}/>
            <Summary label="Dispositivos activos" value={String(activeDevices)} neutral/>
          </div></details>
          <div className="readiness-components">
            {pendingRequirements.map(({component,requirement}) => <div className="readiness-pending" key={component.key}>
              <small>{labels[component.state]??component.state}</small>
              <PrerequisiteNotice state={requirement} onAction={props.onNavigate}/>
            </div>)}
          </div>
          <details className="readiness-checked"><summary>Sin pendientes en {checkedRequirements.length} componentes</summary>
            <ul>{checkedRequirements.map(({component,requirement})=><li key={component.key}>{requirement.label} · <StatusBadge value={component.state}/></li>)}</ul>
          </details>
        </section>

        <section className="admin-section" aria-labelledby="backup-title">
          <div className="section-title-row"><div><h3 id="backup-title">Respaldo y recuperación</h3>
            <p>Las copias son independientes de la sincronización. Configura la copia externa fuera del almacenamiento operativo; ComanView no confirma que esté en otro disco físico.</p></div>
            <StatusBadge value={props.state.backup.recoveryPreparedness}/></div>
          <div className="readiness-summary">
            <Summary label="Copia local" value={props.state.backup.localBackupStatus}/>
            <Summary label="Copia externa" value={props.state.backup.offDeviceBackupStatus}/>
            <Summary label="Clave de recuperación" value={props.state.backup.recoveryKeyExported?'READY':'NOT_READY'}/>
            <Summary label="Recuperación" value={props.state.backup.recoveryState}/>
          </div>
          <p className="backup-last">Último verificado: {props.state.backup.lastVerifiedBackup?formatDate(props.state.backup.lastVerifiedBackup.verifiedAt!):'Todavía no existe una copia verificada.'}</p>
          <div className="backup-actions">
            <div className="backup-create-actions" aria-label="Crear copia manual">
              <button type="button" className="primary-button" disabled={Boolean(props.busyAction)} onClick={()=>void props.onCreateBackup('LOCAL')}>{props.busyAction==='backup-local'?'Creando…':'Crear copia local'}</button>
              <button type="button" className="secondary-button" disabled={Boolean(props.busyAction)||props.state.backup.offDeviceBackupStatus==='NOT_CONFIGURED'} onClick={()=>void props.onCreateBackup('OFF_DEVICE')}>{props.busyAction==='backup-off-device'?'Creando…':'Crear copia externa'}</button>
            </div>
            <label>Carpeta para la copia externa<input value={offDevicePath} onChange={event=>setOffDevicePath(event.target.value)} placeholder="E:\\ComanView-Backups"/></label>
            <button type="button" className="secondary-button" disabled={Boolean(props.busyAction)||offDevicePath.trim().length<3} onClick={()=>void props.onConfigureOffDevice(offDevicePath)}>Configurar destino</button>
            <button type="button" className="secondary-button" disabled={Boolean(props.busyAction)||props.state.backup.recoveryKeyExported} onClick={()=>void props.onExportRecoveryKey().then(setExportedRecoveryKey)}>Exportar clave de recuperación una vez</button>
          </div>
          {exportedRecoveryKey?<div className="inline-alert inline-alert--warning" role="status"><strong>Guárdala ahora en un lugar seguro.</strong><code>{exportedRecoveryKey}</code><button type="button" onClick={()=>setExportedRecoveryKey(null)}>Ya la guardé</button></div>:null}
          <details><summary>Copias recientes ({props.state.backup.recentBackups.length})</summary><div className="pairing-list">{props.state.backup.recentBackups.map(item=><article className="pairing-card" key={item.backupId}><div><strong>{item.destinationType==='LOCAL'?'Local':'Externo'}</strong><span>{formatDate(item.createdAt)} · {backupTriggerLabels[item.trigger]}</span></div><StatusBadge value={item.status}/>{item.status==='VERIFIED'?<button type="button" className="text-danger-button" onClick={()=>setRestoreBackupId(item.backupId)}>Preparar restauración</button>:null}</article>)}</div></details>
          {restoreBackupId?<ConfirmCard title="Restaurar copia verificada" confirmLabel="Restaurar y reiniciar" destructive
            busy={props.busyAction==='restore'} description="La operación local se detendrá, conservará la base actual y validará la copia antes de activarla. Usa esta acción solo para recuperación."
            onCancel={()=>setRestoreBackupId(null)} onConfirm={()=>void props.onRestoreBackup(restoreBackupId).then(()=>setRestoreBackupId(null))}/>:null}
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
                <TechnicalDetails><code>{device.deviceId}</code><span>Estado del dispositivo: {device.status}</span>
                  <span>Alta: {formatDate(device.createdAt)}</span>{device.activatedAt && <span>Activado: {formatDate(device.activatedAt)}</span>}
                  {device.revokedAt && <span>Revocado: {formatDate(device.revokedAt)}</span>}</TechnicalDetails>
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
  </Dialog>;
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
export function StatusBadge({value,label}:{value:string;label?:string}) { const tone=['READY','ACTIVE','VERIFIED','NORMAL'].includes(value)?'success':['NOT_READY','FAILED','REVOKED'].includes(value)?'error':['DEGRADED','PENDING','NOT_CONFIGURED'].includes(value)?'warning':'neutral';return <SharedStatusBadge tone={tone}>{label??labels[value]??value}</SharedStatusBadge>; }
function PairingCard(props:{pairing:PairingStatusResponse;devices:Device[];selected:boolean;actionable:boolean;busy:boolean;onUse(id:string):void;onCancel(pairing:PairingStatusResponse):void}) {
  const status=effectivePairingStatus(props.pairing);
  return <article className={`pairing-card${props.selected?' pairing-card--selected':''}`} aria-current={props.selected?'true':undefined}>
    <div><strong>{deviceDisplayName(props.pairing.device,props.devices)}</strong><span>{props.pairing.device.type} · vence {formatDate(props.pairing.expiresAt)}</span></div>
    <StatusBadge value={status}/><details><summary>Detalles técnicos</summary><code>{props.pairing.pairingId}</code><code>{props.pairing.device.deviceId}</code></details>
    {status==='PENDING'&&props.actionable?<div className="pairing-actions"><button type="button" className="secondary-button compact-button" disabled={props.busy} onClick={()=>props.onUse(props.pairing.pairingId)}>{props.selected?'Solicitud seleccionada':'Usar solicitud'}</button><button type="button" className="text-danger-button" disabled={props.busy} onClick={()=>props.onCancel(props.pairing)}>Cancelar</button></div>:<small className="terminal-help">Esta solicitud ya no admite acciones.</small>}
  </article>;
}
function EmptyState({text}:{text:string}) { return <div className="admin-empty">{text}</div>; }
function ConfirmCard(props:{title:string;description:string;confirmLabel:string;destructive?:boolean;busy:boolean;onCancel():void;onConfirm():void}) { return <ConfirmationDialog open title={props.title} description={props.description} confirmLabel={props.confirmLabel} cancelLabel="Volver" {...(props.destructive?{destructive:true}:{})} loading={props.busy} onClose={props.onCancel} onConfirm={props.onConfirm}/>; }
function formatDate(value:string) { return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
