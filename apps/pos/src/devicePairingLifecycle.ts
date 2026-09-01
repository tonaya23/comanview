import { EdgeClientError, type ClientDeviceIdentity, type ClientDevicePairing } from '@comanview/client-sdk';
import type { PairingCreated, PairingStatus } from '@comanview/contracts';

export type PairingUxState = 'NONE' | 'PENDING' | 'AUTHORIZED' | 'RETRY';

export interface PairingActionAvailability {
  canCopyAuthorizationData: boolean;
  canCompleteBootstrap: boolean;
  canRequestNewPairing: boolean;
  showsOperationalExpiry: boolean;
}

export async function requestPairingWithRevokedIdentityRotation(input:{
  identity:ClientDeviceIdentity;
  requestPairing:(identity:ClientDeviceIdentity)=>Promise<PairingCreated>;
  rotateIdentity:(expectedDeviceId:string)=>Promise<ClientDeviceIdentity|null>;
  onIdentityRotated?:(identity:ClientDeviceIdentity)=>void;
}):Promise<{identity:ClientDeviceIdentity;pairing:PairingCreated;retryCount:0|1}|null>{
  try {
    return {identity:input.identity,pairing:await input.requestPairing(input.identity),retryCount:0};
  } catch(error) {
    if(!(error instanceof EdgeClientError)||error.code!=='DEVICE_REPAIR_REQUIRED')throw error;
    const replacement=await input.rotateIdentity(input.identity.deviceId);
    if(!replacement)return null;
    input.onIdentityRotated?.(replacement);
    return {identity:replacement,pairing:await input.requestPairing(replacement),retryCount:1};
  }
}

export function pairingBelongsToIdentity(
  pairing: ClientDevicePairing,
  identity: Pick<ClientDeviceIdentity, 'deviceId'>,
): boolean {
  return pairing.deviceId === identity.deviceId;
}

export function getPairingUxState(status: PairingStatus | undefined): PairingUxState {
  if (!status) return 'NONE';
  if (status === 'PENDING') return 'PENDING';
  if (status === 'ACTIVE') return 'AUTHORIZED';
  return 'RETRY';
}
export function shouldShowPairingOnLogin(state:'ACTIVE'|'UNREGISTERED'|'PENDING'|'EXPIRED'|'CANCELLED'|'REVOKED') {
  return state!=='ACTIVE';
}

export function getPairingActionAvailability(
  status: PairingStatus | undefined,
): PairingActionAvailability {
  const state = getPairingUxState(status);
  return {
    canCopyAuthorizationData: state === 'PENDING',
    canCompleteBootstrap: state === 'PENDING',
    canRequestNewPairing: state === 'RETRY',
    showsOperationalExpiry: state === 'PENDING',
  };
}

export function shouldAcceptPairingPoll(input: {
  responsePairingId: string;
  responseDeviceId: string;
  expectedPairingId: string;
  expectedDeviceId: string;
  currentDeviceId: string | null;
  generation: number;
  currentGeneration: number;
}): boolean {
  return input.generation === input.currentGeneration
    && input.responsePairingId === input.expectedPairingId
    && input.responseDeviceId === input.expectedDeviceId
    && input.expectedDeviceId === input.currentDeviceId;
}
