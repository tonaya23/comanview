import { describe, expect, it } from 'vitest';
import { loadCloudConfig } from './index.js';

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
});
