import {describe,it,expect} from 'vitest';
import {invalidatesLocalSession} from './sessionErrors.js';
describe('local session classification',()=>{
  it.each(['PERSONNEL_SECURITY_UNAVAILABLE','EDGE_UNREACHABLE','RECOVERY_REQUIRED'])('preserves credentials but does not authorize on %s',code=>{
    expect(invalidatesLocalSession({code,status:401})).toBe(false);
  });
  it.each(['AUTH_SESSION_INVALID','DEVICE_REVOKED','USER_DISABLED','USER_UNTRUSTED','USER_REVIEW_REQUIRED','CREDENTIAL_RESET_REQUIRED','USER_SECURITY_REVISION_CONFLICT'])('invalidates on %s',code=>{
    expect(invalidatesLocalSession({code,status:401})).toBe(true);
  });
});
