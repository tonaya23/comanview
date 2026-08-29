import { describe, expect, it } from 'vitest';
import { CloudAdminClientError, createCloudAdminClient, type CloudAdminFetch } from './cloudAdmin.js';

const session = {
  user: {
    id: '01991a00-0000-7000-8000-000000000301',
    email: 'admin@example.test', displayName: 'Admin', role: 'PLATFORM_ADMIN_READ',
    permissions: ['CLOUD_LOCATION_VIEW', 'CLOUD_OPERATIONAL_VIEW', 'CLOUD_FINANCIAL_VIEW', 'CLOUD_TENANT_READ_ALL'],
    tenantGrants: [],
  },
  session: {
    id: '01991a00-0000-7000-8000-000000000302',
    createdAt: '2026-08-28T12:00:00.000Z', lastActivityAt: '2026-08-28T12:00:00.000Z',
    expiresAt: '2026-08-28T20:00:00.000Z',
  },
};

describe('Cloud Admin client', () => {
  it('uses browser cookie credentials without exposing or sending an Edge token', async () => {
    const calls: Array<{ input: string; init?: Parameters<CloudAdminFetch>[1] }> = [];
    const fetch: CloudAdminFetch = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return { ok: true, status: 200, async json() { return session; } };
    };
    const client = createCloudAdminClient({ baseUrl: 'http://cloud.test', fetch });
    await client.login({ email: 'admin@example.test', password: 'password-123' });
    await client.getSession();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init?.credentials === 'include')).toBe(true);
    expect(calls.every((call) => !call.init?.headers?.['authorization'])).toBe(true);
  });

  it('encodes filters and validates paginated responses', async () => {
    const fetch: CloudAdminFetch = async (input) => {
      expect(input).toContain('status=ONLINE');
      expect(input).toContain('limit=25');
      return { ok: true, status: 200, async json() { return { data: [], page: { nextCursor: null } }; } };
    };
    await expect(createCloudAdminClient({ fetch }).getLocations({ status: 'ONLINE', limit: 25 }))
      .resolves.toEqual({ data: [], page: { nextCursor: null } });
  });

  it('preserves the structured unprovisioned Location error', async () => {
    const fetch: CloudAdminFetch = async () => ({
      ok: false, status: 409,
      async json() {
        return {
          error: 'CLOUD_LOCATION_UNPROVISIONED',
          message: 'Location does not have an ACTIVE Edge yet.',
        };
      },
    });
    const error = await createCloudAdminClient({ fetch }).getOverview('01991a00-0000-7000-8000-000000000303')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CloudAdminClientError);
    expect(error).toMatchObject({ code: 'CLOUD_LOCATION_UNPROVISIONED', status: 409 });
  });
});
