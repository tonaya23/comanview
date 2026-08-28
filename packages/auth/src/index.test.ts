import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashOperationalPin,
  hashSessionToken,
  verifyOperationalPin,
  hashCloudAdminPassword,
  verifyCloudAdminPassword,
} from './index.js';

describe('local authentication primitives', () => {
  it('hashes operational PINs with salt and verifies them safely', async () => {
    const first = await hashOperationalPin('4821');
    const second = await hashOperationalPin('4821');

    expect(first).not.toBe('4821');
    expect(first).not.toBe(second);
    await expect(verifyOperationalPin('4821', first)).resolves.toBe(true);
    await expect(verifyOperationalPin('4822', first)).resolves.toBe(false);
  });

  it('generates unpredictable session tokens and exposes only deterministic hashes for storage', () => {
    const first = generateSessionToken();
    const second = generateSessionToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(first)).toHaveLength(64);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
  });
});

describe('Cloud Admin password hashing', () => {
  it('uses a separate versioned credential format and verifies safely', async () => {
    const hash = await hashCloudAdminPassword('correct-horse-battery-staple');
    expect(hash).toContain('scrypt-cloud-password-v1$');
    expect(hash).not.toContain('correct-horse-battery-staple');
    await expect(verifyCloudAdminPassword('correct-horse-battery-staple', hash)).resolves.toBe(true);
    await expect(verifyCloudAdminPassword('incorrect-password', hash)).resolves.toBe(false);
  });
});
