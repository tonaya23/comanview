import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DevelopmentFileEdgeSecretStore,
  WindowsDpapiEdgeSecretStore,
  createEdgeSecretStore,
} from './EdgeSecretStore.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('EdgeSecretStore', () => {
  it('persists active and pending credentials through the explicit development adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'comanview-secret-')); directories.push(directory);
    const path = join(directory, 'edge-secret.json'); const store = new DevelopmentFileEdgeSecretStore(path);
    const value = { active: { credentialId: crypto.randomUUID(), credential: 'a'.repeat(43) },
      pending: { credentialId: crypto.randomUUID(), credential: 'b'.repeat(43), rotationId: crypto.randomUUID() } };
    await expect(store.hasPersistedState()).resolves.toBe(false);
    await store.save(value); await expect(store.load()).resolves.toEqual(value);
    await expect(store.hasPersistedState()).resolves.toBe(true);
    expect((await readFile(path, 'utf8'))).toContain('"pending"');
  });
  it('rejects the development plaintext adapter in production', () => {
    expect(() => createEdgeSecretStore({ NODE_ENV: 'production', COMANVIEW_EDGE_SECRET_STORE: 'development-file' }))
      .toThrow(/Production Edge credentials require/);
  });
  it.skipIf(process.platform !== 'win32')('encrypts credentials with Windows DPAPI for the current service identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'comanview-dpapi-')); directories.push(directory);
    const path = join(directory, 'edge-secret.bin'); const store = new WindowsDpapiEdgeSecretStore(path);
    const credential = 'production-shaped-secret-that-must-not-be-plaintext';
    const value = { active: { credentialId: crypto.randomUUID(), credential }, pending: null };
    await store.save(value);
    await expect(store.load()).resolves.toEqual(value);
    expect((await readFile(path)).includes(Buffer.from(credential))).toBe(false);
  }, 30_000);
});
