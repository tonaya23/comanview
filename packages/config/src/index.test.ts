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
});
