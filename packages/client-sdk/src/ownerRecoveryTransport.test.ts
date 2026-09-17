import { describe, expect, it, vi } from 'vitest';
import { createCloudAdminClient, type CloudAdminFetch } from './cloudAdmin.js';

const id = '11111111-1111-4111-8111-111111111111';
const context = {
  tenantId: id,
  locationId: id,
  sourceEdgeId: id,
  targetEdgeId: id,
  recoveryId: id,
  backupId: id,
  recoveryEpoch: 1,
  restoreAuthorizationId: null,
  trustDomainId: id,
  accessGeneration: 2,
  challengeId: id,
  deviceId: id,
  pairingId: null,
};
describe('Existing owner authorization endpoint transport', () => {
  it('sends the exact contractual context using the existing authenticated Cloud endpoint', async () => {
    const input = { commandId: id, context, reason: 'Recuperación verificada' };
    const response = {
      authorizationId: id,
      status: 'ISSUED',
      expiresAt: '2026-09-13T12:10:00.000Z',
      authorization: {
        protected: 'fixture-header',
        payload: 'fixture-payload',
        signature: 'fixture-signature',
      },
    };
    const fetch: CloudAdminFetch = vi.fn(async (path, init) => {
      expect(path).toBe(`/admin/v1/locations/${id}/owner-recovery-authorizations`);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      expect(JSON.parse(init?.body ?? '{}')).toEqual(input);
      return { ok: true, status: 201, json: async () => response };
    });
    expect(
      await createCloudAdminClient({ fetch }).issueOwnerRecoveryAuthorization(id, input),
    ).toEqual(response);
  });
  it('rejects an incomplete recovery context before network I/O', async () => {
    const fetch = vi.fn();
    const client = createCloudAdminClient({ fetch });
    expect(() =>
      client.issueOwnerRecoveryAuthorization(id, {
        commandId: id,
        context: { ...context, deviceId: '' },
        reason: 'Prueba segura',
      }),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps existing backend permission denial fail-closed', async () => {
    const fetch: CloudAdminFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'CLOUD_ADMIN_FORBIDDEN', message: 'not public' }),
    });
    await expect(
      createCloudAdminClient({ fetch }).issueOwnerRecoveryAuthorization(id, {
        commandId: id,
        context,
        reason: 'Prueba segura',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'UNKNOWN_CLOUD_ERROR' });
  });
});
