import { describe, expect, it, vi } from 'vitest';
import { EdgeClientError, type ClientDeviceIdentity } from '@comanview/client-sdk';
import {
  getPairingActionAvailability,
  getPairingUxState,
  pairingBelongsToIdentity,
  requestPairingWithRevokedIdentityRotation,
  shouldShowPairingOnLogin,
  shouldAcceptPairingPoll,
} from './devicePairingLifecycle.js';

const pairing = {
  pairingId: '01991a00-0000-7000-8000-000000000401',
  requestToken: 'r'.repeat(43), pairingCode: '123456', expiresAt: '2026-08-29T12:10:00.000Z',
  deviceId: '01991a00-0000-7000-8000-000000000402', currentStatus: 'PENDING' as const,
};
const identity:ClientDeviceIdentity={deviceId:pairing.deviceId,credential:'a'.repeat(43),type:'POS',displayName:'POS principal'};
const replacement:ClientDeviceIdentity={deviceId:'01991a00-0000-7000-8000-000000000499',credential:'b'.repeat(43),type:'POS',displayName:'POS principal'};
const created=(value:ClientDeviceIdentity)=>({pairingId:'01991a00-0000-7000-8000-000000000433',requestToken:'r'.repeat(43),pairingCode:'123456',
  expiresAt:'2026-08-29T12:10:00.000Z',device:{deviceId:value.deviceId,displayName:value.displayName,type:value.type,
    status:'PENDING' as const,createdAt:'2026-08-29T12:00:00.000Z',activatedAt:null,revokedAt:null}});

describe('POS Device pairing lifecycle', () => {
  it('separates actionable PENDING from every terminal status', () => {
    expect(getPairingUxState('PENDING')).toBe('PENDING');
    expect(getPairingUxState('ACTIVE')).toBe('AUTHORIZED');
    expect(getPairingUxState('EXPIRED')).toBe('RETRY');
    expect(getPairingUxState('CANCELLED')).toBe('RETRY');
  });

  it('removes onboarding actions and operational expiry after pairing becomes ACTIVE', () => {
    expect(getPairingActionAvailability('ACTIVE')).toEqual({
      canCopyAuthorizationData: false,
      canCompleteBootstrap: false,
      canRequestNewPairing: false,
      showsOperationalExpiry: false,
    });
  });
  it.each([
    ['ACTIVE',false],['UNREGISTERED',true],['REVOKED',true],['PENDING',true],
  ] as const)('shows pairing CTA for %s only when appropriate',(state,visible)=>{
    expect(shouldShowPairingOnLogin(state)).toBe(visible);
  });

  it.each(['EXPIRED', 'CANCELLED'] as const)(
    'allows only a new pairing for terminal status %s',
    (status) => {
      expect(getPairingActionAvailability(status)).toEqual({
        canCopyAuthorizationData: false,
        canCompleteBootstrap: false,
        canRequestNewPairing: true,
        showsOperationalExpiry: false,
      });
    },
  );

  it('rejects a stored pairing that belongs to a previous Device identity', () => {
    expect(pairingBelongsToIdentity(pairing, { deviceId: pairing.deviceId })).toBe(true);
    expect(pairingBelongsToIdentity(pairing, { deviceId: '01991a00-0000-7000-8000-000000000499' })).toBe(false);
  });

  it('rejects a polling response after cleanup advanced the generation', () => {
    expect(shouldAcceptPairingPoll({responsePairingId:pairing.pairingId,responseDeviceId:pairing.deviceId,expectedPairingId:pairing.pairingId,
      expectedDeviceId:pairing.deviceId,currentDeviceId:pairing.deviceId,generation:2,currentGeneration:3})).toBe(false);
  });

  it('rejects a polling response after the Device identity changed', () => {
    expect(shouldAcceptPairingPoll({responsePairingId:pairing.pairingId,responseDeviceId:pairing.deviceId,expectedPairingId:pairing.pairingId,
      expectedDeviceId:pairing.deviceId,currentDeviceId:'01991a00-0000-7000-8000-000000000499',
      generation:2,currentGeneration:2})).toBe(false);
  });

  it('rejects a polling response bound to a different Device', () => {
    expect(shouldAcceptPairingPoll({
      responsePairingId: pairing.pairingId,
      responseDeviceId: '01991a00-0000-7000-8000-000000000498',
      expectedPairingId: pairing.pairingId,
      expectedDeviceId: pairing.deviceId,
      currentDeviceId: pairing.deviceId,
      generation: 2,
      currentGeneration: 2,
    })).toBe(false);
  });

  it('rotates once only after the authoritative repair-required signal',async()=>{
    const requestPairing=vi.fn().mockRejectedValueOnce(new EdgeClientError('repair','DEVICE_REPAIR_REQUIRED',409))
      .mockResolvedValueOnce(created(replacement));
    const rotateIdentity=vi.fn().mockResolvedValue(replacement);
    const onIdentityRotated=vi.fn();
    await expect(requestPairingWithRevokedIdentityRotation({identity,requestPairing,rotateIdentity,onIdentityRotated}))
      .resolves.toMatchObject({identity:replacement,retryCount:1,pairing:{device:{deviceId:replacement.deviceId}}});
    expect(requestPairing).toHaveBeenCalledTimes(2);
    expect(requestPairing).toHaveBeenNthCalledWith(1,identity);
    expect(requestPairing).toHaveBeenNthCalledWith(2,replacement);
    expect(rotateIdentity).toHaveBeenCalledWith(identity.deviceId);
    expect(onIdentityRotated).toHaveBeenCalledWith(replacement);
  });

  it.each([
    ['DEVICE_ALREADY_REGISTERED',409],['EDGE_UNREACHABLE',null],['AUTHENTICATION_REQUIRED',401],
    ['PERMISSION_DENIED',403],['DEVICE_LIMIT_REACHED',409],
  ] as const)('does not rotate for %s',async(code,status)=>{
    const problem=new EdgeClientError('rejected',code,status);
    const requestPairing=vi.fn().mockRejectedValue(problem);const rotateIdentity=vi.fn();
    await expect(requestPairingWithRevokedIdentityRotation({identity,requestPairing,rotateIdentity})).rejects.toBe(problem);
    expect(requestPairing).toHaveBeenCalledOnce();expect(rotateIdentity).not.toHaveBeenCalled();
  });

  it('does not loop if the single retry is also rejected',async()=>{
    const problem=new EdgeClientError('repair','DEVICE_REPAIR_REQUIRED',409);
    const requestPairing=vi.fn().mockRejectedValue(problem);const rotateIdentity=vi.fn().mockResolvedValue(replacement);
    await expect(requestPairingWithRevokedIdentityRotation({identity,requestPairing,rotateIdentity})).rejects.toBe(problem);
    expect(requestPairing).toHaveBeenCalledTimes(2);expect(rotateIdentity).toHaveBeenCalledOnce();
  });

  it('abandons recovery when the expected identity is stale',async()=>{
    const requestPairing=vi.fn().mockRejectedValueOnce(new EdgeClientError('repair','DEVICE_REPAIR_REQUIRED',409));
    const rotateIdentity=vi.fn().mockResolvedValue(null);
    await expect(requestPairingWithRevokedIdentityRotation({identity,requestPairing,rotateIdentity})).resolves.toBeNull();
    expect(requestPairing).toHaveBeenCalledOnce();
  });
});
