import { describe, expect, it } from 'vitest';
import { loadCloudConfig, loadEdgeSyncConfig } from './index.js';

const base = { DATABASE_URL: 'postgresql://localhost/comanview_test' };

describe('Cloud Admin configuration', () => {
  it('uses approved status thresholds and does not bootstrap by default', () => {
    const config = loadCloudConfig({ ...base, NODE_ENV: 'test' });
    expect(config.admin).toMatchObject({
      heartbeatStaleThresholdMs: 90_000,
      projectionLagThresholdMs: 120_000,
      developmentBootstrap: null,
    });
  });
  it('forbids known development bootstrap credentials in production', () => {
    expect(() => loadCloudConfig({
      ...base, NODE_ENV: 'production', COMANVIEW_CLOUD_DEV_ADMIN_EMAIL: 'admin@example.test',
      COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD: 'not-a-production-secret',
    })).toThrow('forbidden in production');
  });

  it('forbids legacy Cloud and Edge credential bootstrap in production', () => {
    expect(() => loadCloudConfig({
      ...base,
      NODE_ENV: 'production',
      COMANVIEW_CLOUD_EDGE_CREDENTIALS: JSON.stringify([{
        edgeId: '01991a00-0000-7000-8000-000000000001',
        tenantId: '01991a00-0000-7000-8000-000000000002',
        locationId: '01991a00-0000-7000-8000-000000000003',
        token: 'legacy-development-token',
      }]),
    })).toThrow('COMANVIEW_CLOUD_EDGE_CREDENTIALS is forbidden in production');
    expect(() => loadEdgeSyncConfig({
      NODE_ENV: 'production',
      COMANVIEW_CLOUD_URL: 'https://cloud.example.test',
      COMANVIEW_EDGE_SYNC_TOKEN: 'legacy-development-token',
    })).toThrow('COMANVIEW_EDGE_SYNC_TOKEN');
    expect(() => loadEdgeSyncConfig({
      NODE_ENV: 'production',
      COMANVIEW_CLOUD_URL: 'https://cloud.example.test',
      COMANVIEW_EDGE_ID: '01991a00-0000-7000-8000-000000000001',
    })).toThrow('COMANVIEW_EDGE_ID');
  });

  it('requires deployment signing material and an Edge public keyring in production', () => {
    expect(() => loadCloudConfig({ ...base, NODE_ENV: 'production' }))
      .toThrow('Cloud signing key deployment secrets are required');
    expect(() => loadEdgeSyncConfig({ NODE_ENV: 'production' }))
      .toThrow('COMANVIEW_LICENSE_PUBLIC_KEYRING');
  });

  it('uses the approved temporal delivery policy when licensing is enabled', () => {
    const config = loadEdgeSyncConfig({
      NODE_ENV: 'test', COMANVIEW_LICENSE_ENFORCEMENT_ENABLED: 'true',
      COMANVIEW_LICENSE_PUBLIC_KEYRING: JSON.stringify({
        current: '-----BEGIN PUBLIC KEY-----\ntest-development-public-key-material\n-----END PUBLIC KEY-----',
        next: '-----BEGIN PUBLIC KEY-----\nnext-development-public-key-material\n-----END PUBLIC KEY-----',
      }),
    });
    expect(config.licensing).toMatchObject({
      enforcementEnabled: true, pullIntervalMs: 300_000,
      maxBackoffMs: 3_600_000, checkpointIntervalMs: 60_000,
    });
    expect(Object.keys(config.licensing.publicKeyring)).toEqual(['current', 'next']);
  });
});
