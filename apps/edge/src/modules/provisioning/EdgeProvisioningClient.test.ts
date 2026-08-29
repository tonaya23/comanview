import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEdgeDatabase, prepareDevelopmentDatabase, SyncOutboxRepository } from '@comanview/database';
import { DevelopmentFileEdgeSecretStore } from './EdgeSecretStore.js';
import { EdgeProvisioningClient } from './EdgeProvisioningClient.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('EdgeProvisioningClient', () => {
  it('persists the generated credential before exchange and resumes the same attempt after a lost response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'comanview-provision-')); directories.push(directory);
    const dbPath = join(directory, 'edge.db'); const secretPath = join(directory, 'secret.json');
    prepareDevelopmentDatabase(dbPath); const database = createEdgeDatabase(dbPath);
    const repository = new SyncOutboxRepository(database.db); const secrets = new DevelopmentFileEdgeSecretStore(secretPath);
    const failedFetch = vi.fn(async () => { throw new Error('connection lost after send'); });
    await expect(new EdgeProvisioningClient(repository, secrets, 'http://cloud.test', failedFetch as typeof fetch).provision('p'.repeat(32))).rejects.toThrow();
    const journal = repository.getProvisioningJournal(); const pending = (await secrets.load()).pending;
    expect(journal?.state).toBe('CREDENTIAL_STORED'); expect(pending?.credentialId).toBe(journal?.credentialId);
    const successfulFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      if (String(_url).endsWith('/exchange')) return Response.json({ attemptId: body['attemptId'],
        credentialId: body['credentialId'], replacement: false, edge: { edgeId: body['edgeId'],
          tenantId: '01991a00-0000-7000-8000-000000000301', locationId: '01991a00-0000-7000-8000-000000000302',
          status: 'PROVISIONING', provisionedAt: new Date().toISOString(), activatedAt: null,
          revokedAt: null, replacedAt: null, replacedByEdgeId: null } });
      return Response.json({ edge: { edgeId: body['edgeId'], tenantId: '01991a00-0000-7000-8000-000000000301',
        locationId: '01991a00-0000-7000-8000-000000000302', status: 'ACTIVE', provisionedAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(), revokedAt: null, replacedAt: null, replacedByEdgeId: null } });
    });
    const result = await new EdgeProvisioningClient(repository, secrets, 'http://cloud.test', successfulFetch as typeof fetch).provision('p'.repeat(32));
    expect(result.status).toBe('ACTIVE'); expect(repository.findIdentity()).toMatchObject({ provisioningState: 'ACTIVE', edgeId: journal?.edgeId });
    expect((await secrets.load())).toEqual({ active: pending, pending: null }); database.close();
  });
});
