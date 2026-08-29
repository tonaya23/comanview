import { describe, expect, it } from 'vitest';
import { EdgeAuthenticator, hashEdgeToken } from './EdgeAuthenticator.js';

const edge = {
  edgeId: '01991a00-1000-7000-8000-000000000007',
  tenantId: '01991a00-1000-7000-8000-000000000003',
  locationId: '01991a00-1000-7000-8000-000000000004',
  credentialHash: hashEdgeToken('legacy-credential'),
  status: 'ACTIVE',
};

describe('EdgeAuthenticator credential lifecycle', () => {
  it('does not fall back to a legacy credential after the durable credential set is empty', async () => {
    const authenticator = new EdgeAuthenticator({
      getEdge: async () => ({ ...edge, credentialHashes: [] }),
    });

    await expect(
      authenticator.authenticate(edge.edgeId, 'Bearer legacy-credential'),
    ).rejects.toMatchObject({ code: 'EDGE_AUTH_INVALID', statusCode: 401 });
  });

  it('accepts a RETIRING credential only during its overlap window', async () => {
    const token = 'retiring-credential';
    const active = new EdgeAuthenticator({
      getEdge: async () => ({
        ...edge,
        credentialHashes: [
          { hash: hashEdgeToken(token), status: 'RETIRING', retireAfter: new Date(Date.now() + 60_000) },
        ],
      }),
    });
    await expect(active.authenticate(edge.edgeId, `Bearer ${token}`)).resolves.toMatchObject({ edgeId: edge.edgeId });

    const expired = new EdgeAuthenticator({
      getEdge: async () => ({
        ...edge,
        credentialHashes: [
          { hash: hashEdgeToken(token), status: 'RETIRING', retireAfter: new Date(Date.now() - 1) },
        ],
      }),
    });
    await expect(expired.authenticate(edge.edgeId, `Bearer ${token}`)).rejects.toMatchObject({ code: 'EDGE_AUTH_INVALID' });
  });
});
