import { EdgeClientError, type EdgeClient } from '@comanview/client-sdk';
import type { Device, InstallationReadiness, PairingStatus, PairingStatusResponse,BackupProtectionStatus } from '@comanview/contracts';

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
  if (!(problem instanceof EdgeClientError)) {
    return problem instanceof Error ? problem.message : 'No fue posible completar la operación.';
  }
  const messages: Record<string, string> = {
    DEVICE_LIMIT_REACHED: 'Se alcanzó el límite de dispositivos activos para este tipo.',
    PAIRING_CODE_INVALID: 'El código de emparejamiento no es válido.',
    PAIRING_EXPIRED: 'La solicitud de emparejamiento expiró. Genera una nueva desde el dispositivo.',
    PAIRING_ALREADY_CONSUMED: 'La solicitud ya fue aprobada, cancelada o dejó de estar disponible.',
    DEVICE_NOT_AUTHORIZED: 'El dispositivo ya no está disponible para esta operación.',
    PERMISSION_DENIED: 'Tu usuario no tiene permiso para realizar esta acción.',
    BACKUP_DESTINATION_UNAVAILABLE: 'El destino externo no está disponible. Verifica la unidad o la ruta e inténtalo nuevamente.',
  };
  return messages[problem.code] ?? problem.message;
}

export function isGlobalDeviceAdminError(problem: unknown): boolean {
  return problem instanceof EdgeClientError && [
    'EDGE_UNREACHABLE', 'AUTHENTICATION_REQUIRED', 'AUTH_SESSION_INVALID', 'DEVICE_REVOKED',
  ].includes(problem.code);
}
