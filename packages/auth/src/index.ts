import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = {
  CATALOG_VIEW: 'CATALOG_VIEW',
  CATALOG_MANAGE: 'CATALOG_MANAGE',
  ORDER_VIEW: 'ORDER_VIEW',
  ORDER_CREATE: 'ORDER_CREATE',
  ORDER_EDIT_DRAFT: 'ORDER_EDIT_DRAFT',
  ORDER_SEND: 'ORDER_SEND',
  ORDER_CLOSE: 'ORDER_CLOSE',
  ORDER_CANCEL: 'ORDER_CANCEL',
  ORDER_CANCEL_EMPTY: 'ORDER_CANCEL_EMPTY',
  ORDER_REQUEST_PAYMENT: 'ORDER_REQUEST_PAYMENT',
  CASH_SESSION_VIEW: 'CASH_SESSION_VIEW',
  CASH_SESSION_OPEN: 'CASH_SESSION_OPEN',
  CASH_MOVEMENT_CREATE: 'CASH_MOVEMENT_CREATE',
  CASH_REPORT_X: 'CASH_REPORT_X',
  CASH_SESSION_CLOSE: 'CASH_SESSION_CLOSE',
  PAYMENT_CONFIG_VIEW: 'PAYMENT_CONFIG_VIEW',
  PAYMENT_CREATE: 'PAYMENT_CREATE',
  PAYMENT_VOID: 'PAYMENT_VOID',
  PRINT_PRECHECK: 'PRINT_PRECHECK',
  PRINT_RECEIPT: 'PRINT_RECEIPT',
  PRINT_JOBS_VIEW: 'PRINT_JOBS_VIEW',
  KDS_VIEW: 'KDS_VIEW',
  KDS_UPDATE_PREPARATION: 'KDS_UPDATE_PREPARATION',
  AUDIT_VIEW: 'AUDIT_VIEW',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export type BaseRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export const CLOUD_PERMISSIONS = {
  CLOUD_LOCATION_VIEW: 'CLOUD_LOCATION_VIEW',
  CLOUD_OPERATIONAL_VIEW: 'CLOUD_OPERATIONAL_VIEW',
  CLOUD_FINANCIAL_VIEW: 'CLOUD_FINANCIAL_VIEW',
  CLOUD_TENANT_READ_ALL: 'CLOUD_TENANT_READ_ALL',
} as const;

export type CloudPermission = (typeof CLOUD_PERMISSIONS)[keyof typeof CLOUD_PERMISSIONS];
export type CloudAdminRole = 'PLATFORM_ADMIN_READ' | 'SUPPORT_READ';

export const CLOUD_ROLE_PERMISSIONS: Readonly<Record<CloudAdminRole, readonly CloudPermission[]>> = {
  PLATFORM_ADMIN_READ: Object.values(CLOUD_PERMISSIONS),
  SUPPORT_READ: [
    CLOUD_PERMISSIONS.CLOUD_LOCATION_VIEW,
    CLOUD_PERMISSIONS.CLOUD_OPERATIONAL_VIEW,
  ],
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const BASE_ROLE_PERMISSIONS: Readonly<Record<BaseRole, readonly Permission[]>> = {
  OWNER: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS,
  CASHIER: [
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_EDIT_DRAFT,
    PERMISSIONS.ORDER_SEND,
    PERMISSIONS.ORDER_CLOSE,
    PERMISSIONS.CASH_SESSION_VIEW,
    PERMISSIONS.CASH_SESSION_OPEN,
    PERMISSIONS.CASH_MOVEMENT_CREATE,
    PERMISSIONS.CASH_REPORT_X,
    PERMISSIONS.CASH_SESSION_CLOSE,
    PERMISSIONS.PAYMENT_CONFIG_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.PRINT_PRECHECK,
    PERMISSIONS.PRINT_RECEIPT,
    PERMISSIONS.PRINT_JOBS_VIEW,
  ],
  WAITER: [
    PERMISSIONS.CATALOG_VIEW,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_EDIT_DRAFT,
    PERMISSIONS.ORDER_SEND,
    PERMISSIONS.ORDER_CANCEL_EMPTY,
    PERMISSIONS.ORDER_REQUEST_PAYMENT,
    PERMISSIONS.PRINT_PRECHECK,
  ],
  KITCHEN: [PERMISSIONS.KDS_VIEW, PERMISSIONS.KDS_UPDATE_PREPARATION],
};

const SCRYPT_VERSION = 'scrypt-v1';
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const CLOUD_PASSWORD_VERSION = 'scrypt-cloud-password-v1';

function derivePin(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAX_MEMORY },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

export async function hashOperationalPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePin(pin, salt);
  return [
    SCRYPT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export function hashOperationalPinSync(pin: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return [
    SCRYPT_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyOperationalPin(pin: string, encodedHash: string): Promise<boolean> {
  const [version, n, r, p, saltValue, hashValue] = encodedHash.split('$');
  if (
    version !== SCRYPT_VERSION ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await derivePin(pin, Buffer.from(saltValue, 'base64url'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function hashCloudAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePin(password, salt);
  return [
    CLOUD_PASSWORD_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyCloudAdminPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [version, n, r, p, saltValue, hashValue] = encodedHash.split('$');
  if (
    version !== CLOUD_PASSWORD_VERSION ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await derivePin(password, Buffer.from(saltValue, 'base64url'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
