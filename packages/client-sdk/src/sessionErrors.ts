/** Error codes, never human text or a blanket HTTP status, determine local session removal. */
export function invalidatesLocalSession(problem:unknown):boolean {
  if(!problem||typeof problem!=='object'||!('code' in problem))return false;
  return new Set(['AUTHENTICATION_REQUIRED','AUTH_SESSION_INVALID','DEVICE_REVOKED',
    'DEVICE_NOT_AUTHORIZED','DEVICE_CREDENTIAL_INVALID','USER_DISABLED','USER_UNTRUSTED',
    'USER_REVIEW_REQUIRED','CREDENTIAL_RESET_REQUIRED','USER_SECURITY_REPAIR_REQUIRED',
    'USER_SECURITY_REVISION_CONFLICT','PERSONNEL_SECURITY_NOT_INITIALIZED']).has(String(problem.code));
}
