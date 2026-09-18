import { expect, it, vi } from 'vitest';
import { createEdgeClient } from './index.js';
const id = '01991a00-0000-7000-8000-000000000711';
it('administrative assignment DTOs preserve shared version, generation and reference through SDK', async () => {
  for (const kind of ['TAX_PROFILE', 'STATION'] as const) {
    const result = {
      entityId: id,
      version: 5,
      catalogGeneration: 11,
      changed: false,
      recoveryEpoch: 3,
      reference: { kind, id, version: 2 },
    };
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => result })),
      client = createEdgeClient({ fetch });
    const command = {
      commandId: id,
      expectedVersion: 5,
      productId: id,
      reason: 'Assign reference',
    };
    const actual =
      kind === 'TAX_PROFILE'
        ? await client.executeTaxAdministration({
            ...command,
            kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
            profileId: id,
            profileVersion: 2,
          })
        : await client.executeRestaurantAdministration({
            ...command,
            kind: 'ASSIGN_PRODUCT_STATION',
            stationId: id,
            stationVersion: 2,
          });
    expect(actual).toEqual(result);
  }
});
it('preserves command identity and exact authoritative versions across ACK retry', async () => {
  const result = {
    commandId: id,
    entityType: 'CATEGORY',
    entityId: id,
    version: 4,
    catalogGeneration: 9007199254740000,
    recoveryEpoch: 7,
    changed: true,
    entities: [{ id, name: 'Food', version: 4, displayOrder: 0, active: true, systemKey: null }],
  };
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => result }));
  const client = createEdgeClient({ baseUrl: 'http://localhost:3000', fetch });
  const command = {
    commandId: id,
    kind: 'CREATE_CATEGORY' as const,
    expectedVersion: 0 as const,
    payload: { name: 'Food' },
  };
  expect(await client.catalogCommand(command)).toEqual(result);
  expect(await client.catalogCommand(command)).toEqual(result);
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
});
it('preserves catalog conflict code, safe OCC details and diagnostic reference', async () => {
  const details = {
    entityType: 'PRODUCT',
    entityId: id,
    expectedVersion: 1,
    actualVersion: 2,
    diagnosticId: 'req-safe',
  };
  const client = createEdgeClient({
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'CATALOG_VERSION_CONFLICT', message: 'Conflict', details }),
    }),
  });
  await expect(
    client.catalogCommand({
      kind: 'SET_PRODUCT_AVAILABILITY',
      commandId: id,
      entityId: id,
      expectedVersion: 1,
      payload: { available: true },
    }),
  ).rejects.toMatchObject({ code: 'CATALOG_VERSION_CONFLICT', details });
});
