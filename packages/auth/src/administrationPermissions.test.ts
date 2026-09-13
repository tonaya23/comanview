import { describe, expect, it } from 'vitest';
import { BASE_ROLE_PERMISSIONS, PERMISSIONS } from './index.js';

describe('1W administrative role allowlists', () => {
  it.each([
    PERMISSIONS.BUSINESS_DAY_POLICY_MANAGE, PERMISSIONS.CURRENCY_MANAGE,
    PERMISSIONS.TAX_PROFILE_MANAGE, PERMISSIONS.PERSONNEL_PRIVILEGED_MANAGE,
    PERMISSIONS.PERSONNEL_RECOVERY, PERMISSIONS.TIP_PREFERENCES_MANAGE,
    PERMISSIONS.RECOVERY_EXECUTE,
  ])('keeps %s OWNER-only', permission => {
    expect(BASE_ROLE_PERMISSIONS.OWNER).toContain(permission);
    for (const role of ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const)
      expect(BASE_ROLE_PERMISSIONS[role]).not.toContain(permission);
  });
  it('allows MANAGER scoped operational administration', () => {
    for (const permission of [PERMISSIONS.ADMINISTRATION_VIEW, PERMISSIONS.BUSINESS_PROFILE_MANAGE,
      PERMISSIONS.PERSONNEL_MANAGE, PERMISSIONS.CASH_REGISTER_MANAGE, PERMISSIONS.STATION_MANAGE, PERMISSIONS.TABLE_MANAGE])
      expect(BASE_ROLE_PERMISSIONS.MANAGER).toContain(permission);
  });
  it('allows own PIN changes but never staff management to operational roles', () => {
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN'] as const) {
      expect(BASE_ROLE_PERMISSIONS[role]).toContain(PERMISSIONS.OWN_PIN_CHANGE);
      expect(BASE_ROLE_PERMISSIONS[role]).not.toContain(PERMISSIONS.PERSONNEL_MANAGE);
    }
  });
  it('does not accidentally remove existing MANAGER operational permissions', () => {
    for (const permission of [PERMISSIONS.PAYMENT_VOID, PERMISSIONS.CASH_SESSION_CLOSE, PERMISSIONS.DEVICE_REVOKE,
      PERMISSIONS.BACKUP_CREATE, PERMISSIONS.ORDER_CANCEL, PERMISSIONS.CATALOG_MANAGE])
      expect(BASE_ROLE_PERMISSIONS.MANAGER).toContain(permission);
  });
  it('contains no duplicate role grants', () => {
    for (const grants of Object.values(BASE_ROLE_PERMISSIONS)) expect(new Set(grants).size).toBe(grants.length);
  });
});
