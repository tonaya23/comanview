import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type { Device, InstallationReadiness, PairingStatus, PairingStatusResponse,BackupProtectionStatus } from '@comanview/contracts';
import { getUserGuidance, navigationTarget, prerequisite, type PrerequisiteState, type TypedNavigationTarget } from '@comanview/ui';

type DeviceAdminClient = Pick<
  EdgeClient,
  'getDevices' | 'getPendingPairings' | 'getInstallationReadiness' | 'getBackupStatus'
>;

export async function loadDeviceAdminState(client: DeviceAdminClient) {
  const [devices, pairings, readiness,backup] = await Promise.all([
    client.getDevices(),
    client.getPendingPairings(),
    client.getInstallationReadiness(),
    client.getBackupStatus(),
  ]);
  return { devices: devices.data, pairings: pairings.data, readiness,backup };
}

export interface DeviceAdminState {
  devices: Device[];
  pairings: PairingStatusResponse[];
  readiness: InstallationReadiness;
  backup: BackupProtectionStatus;
}

const readinessTargets:Partial<Record<string,TypedNavigationTarget>>={
  CASH_REGISTER:navigationTarget.administration('registers'),
  STATIONS:navigationTarget.administration('stations'),USERS:navigationTarget.administration('personnel'),
  RBAC:navigationTarget.administration('personnel'),PERSONNEL_SECURITY:navigationTarget.administration('personnel'),
  DEVICES:navigationTarget.system('devices'),BOOTSTRAP:navigationTarget.system('devices'),BACKUP:navigationTarget.system('backup-recovery'),
};
const readinessExplanations:Record<string,string>={
  ADMINISTRATION:'Completa el perfil del negocio, el día de operación, la moneda, la caja y los impuestos.',
  CASH_REGISTER:'Crea una caja activa y selecciónala como predeterminada.',STATIONS:'Configura una estación activa para el recorrido de cocina.',
  USERS:'La instalación necesita al menos una persona activa.',RBAC:'La configuración de permisos locales está incompleta.',
  PERSONNEL_SECURITY:'Revisa la seguridad del personal y confirma que existe un Owner confiable.',
  DEVICES:'Autoriza al menos un dispositivo para operar.',BOOTSTRAP:'Completa la instalación inicial desde un dispositivo autorizado.',
  BACKUP:'Completa la preparación de respaldo y recuperación.',CATALOG:'Agrega productos activos antes de iniciar la operación comercial.',
  PRINTING:'Configura un destino de impresión cuando esta capacidad sea necesaria.',SYNC:'La última sincronización todavía no se ha verificado.',
  LICENSE:'La licencia o alguna de sus capacidades requiere atención del administrador de la cuenta.',
};
const readinessActionLabels:Record<string,string>={ADMINISTRATION:'Configurar restaurante',CASH_REGISTER:'Configurar cajas',STATIONS:'Configurar estaciones',USERS:'Administrar personal',RBAC:'Revisar personal',PERSONNEL_SECURITY:'Revisar personal',DEVICES:'Administrar dispositivos',BOOTSTRAP:'Completar instalación',BACKUP:'Abrir respaldo y recuperación'};

export function readinessPrerequisite(
  component:InstallationReadiness['components'][number],
  canNavigate:(target:TypedNavigationTarget)=>boolean=()=>true,
):PrerequisiteState{
  const status=component.state==='READY'?'complete':component.state==='NOT_APPLICABLE'||component.state==='PENDING_PHASE'?'not-applicable':
    component.code==='RECOVERY_REQUIRED'||component.key==='LICENSE'?'blocked':component.state==='DEGRADED'?'unavailable':'missing';
  const target=readinessTargets[component.key],action=target&&canNavigate(target)?{label:readinessActionLabels[component.key]??'Resolver',target}:undefined;
  const guidance=getUserGuidance(component.code,{
    title:componentLabel(component.key),explanation:readinessExplanations[component.key]??'Este componente necesita atención antes de considerar lista la instalación.',
    severity:status==='blocked'?'error':status==='unavailable'?'warning':'warning',retryability:action?'after-action':'contact-administrator',action:action??null,
  });
  return prerequisite({key:component.key,label:componentLabel(component.key),status,reasonCode:component.code,guidance,...(action?{action}:{}),authority:{source:component.key==='LICENSE'?'signed-configuration':'edge'}});
}

export function componentLabel(key:string) { return ({EDGE:'Operación local',DATABASE:'Base de datos',TENANT_LOCATION:'Restaurante y ubicación',LICENSE:'Licencia',CATALOG:'Catálogo',USERS:'Personal',RBAC:'Permisos locales',CASH_REGISTER:'Caja',STATIONS:'Estaciones de cocina',PRINTING:'Impresión',DEVICES:'Dispositivos',BOOTSTRAP:'Instalación inicial',SYNC:'Sincronización',BACKUP:'Respaldo y recuperación',ADMINISTRATION:'Configuración del restaurante',PERSONNEL_SECURITY:'Seguridad del personal'} as Record<string,string>)[key]??'Componente de instalación'; }

export type DeviceInstallationPresentation = {
  label: 'Activo' | 'Revocado' | 'Pendiente activo' | 'No completado';
  detail: string;
  tone: 'ACTIVE' | 'REVOKED' | 'PENDING' | 'CANCELLED' | 'EXPIRED';
};

export function deviceInstallationPresentation(
  device: Device,
  pairings: readonly PairingStatusResponse[],
  now = Date.now(),
): DeviceInstallationPresentation {
  if (device.status === 'ACTIVE') return { label: 'Activo', detail: 'Dispositivo autorizado.', tone: 'ACTIVE' };
  if (device.status === 'REVOKED') return { label: 'Revocado', detail: 'La autorización fue revocada.', tone: 'REVOKED' };
  const related = pairings.filter((pairing) => pairing.device.deviceId === device.deviceId);
  if (related.some((pairing) => effectivePairingStatus(pairing, now) === 'PENDING')) {
    return { label: 'Pendiente activo', detail: 'Hay una solicitud vigente por completar.', tone: 'PENDING' };
  }
  const latestStatus = related[0] ? effectivePairingStatus(related[0], now) : null;
  if (latestStatus === 'CANCELLED') return { label: 'No completado', detail: 'Última solicitud cancelada.', tone: 'CANCELLED' };
  if (latestStatus === 'EXPIRED') return { label: 'No completado', detail: 'Última solicitud expirada.', tone: 'EXPIRED' };
  return { label: 'No completado', detail: 'No hay una solicitud vigente.', tone: 'EXPIRED' };
}

export function groupPairings(pairings: readonly PairingStatusResponse[], now = Date.now()) {
  const active: PairingStatusResponse[] = [];
  const history: PairingStatusResponse[] = [];
  for (const pairing of pairings) {
    (effectivePairingStatus(pairing, now) === 'PENDING' ? active : history).push(pairing);
  }
  return { active, history };
}

export function effectivePairingStatus(pairing: PairingStatusResponse, now = Date.now()): PairingStatus {
  return pairing.status === 'PENDING' && Date.parse(pairing.expiresAt) <= now ? 'EXPIRED' : pairing.status;
}

export function shouldClearPairingApproval(
  pairings:readonly PairingStatusResponse[],
  selectedPairingId:string,
  now=Date.now(),
):boolean {
  if(!selectedPairingId)return false;
  const selected=pairings.find(pairing=>pairing.pairingId===selectedPairingId);
  return !selected||effectivePairingStatus(selected,now)!=='PENDING';
}

export function clearPairingApproval(onPairingId:(value:string)=>void,onCode:(value:string)=>void) {
  onPairingId('');
  onCode('');
}

export function deviceDisplayName(device: Device, devices: readonly Device[]): string {
  const duplicated = devices.filter((candidate) => candidate.displayName === device.displayName).length > 1;
  return duplicated ? `${device.displayName} · ${device.type} · …${device.deviceId.slice(-6)}` : device.displayName;
}

export function deviceAdminErrorMessage(problem: unknown): string {
  if (!(problem instanceof EdgeClientError)) return getUserGuidance('UNKNOWN_EDGE_ERROR').explanation;
  return getUserGuidance(problem).explanation;
}

export function isGlobalDeviceAdminError(problem: unknown): boolean {
  return problem instanceof EdgeClientError && [
    'EDGE_UNREACHABLE', 'AUTHENTICATION_REQUIRED', 'AUTH_SESSION_INVALID', 'DEVICE_REVOKED',
  ].includes(problem.code);
}
