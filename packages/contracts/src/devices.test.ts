import { describe, expect, it } from 'vitest';
import { PairingAuthorizationDataSchema } from './devices.js';
import { ErrorResponseSchema } from './errors.js';

const valid = {
  schemaVersion: 1,
  pairingId: '01991a00-0000-7000-8000-000000000401',
  pairingCode: '123456',
  deviceId: '01991a00-0000-7000-8000-000000000402',
  deviceType: 'POS',
  displayName: 'POS principal',
} as const;

describe('PairingAuthorizationDataSchema', () => {
  it('accepts the complete versioned public pairing transfer', () => {
    expect(PairingAuthorizationDataSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['schemaVersion', { ...valid, schemaVersion: 2 }],
    ['pairingId', { ...valid, pairingId: 'invalid' }],
    ['pairingCode', { ...valid, pairingCode: '12345' }],
    ['deviceType', { ...valid, deviceType: 'PRINTER' }],
    ['required field', { ...valid, displayName: undefined }],
    ['unknown field', { ...valid, requestToken: 'must-not-be-accepted' }],
  ])('rejects an invalid %s', (_label, value) => {
    expect(PairingAuthorizationDataSchema.safeParse(value).success).toBe(false);
  });

  it('recognizes the stable repair-required signal without accepting arbitrary codes',()=>{
    expect(ErrorResponseSchema.parse({error:'DEVICE_REPAIR_REQUIRED',message:'Repair required.'}).error)
      .toBe('DEVICE_REPAIR_REQUIRED');
  });
});
