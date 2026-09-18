import { expect, it } from 'vitest';
import { CatalogCommandSchema } from './catalogCommands.js';
import {
  TaxAdministrationCommandSchema,
  TaxAdministrationResultSchema,
} from './taxAdministration.js';
import {
  RestaurantAdministrationCommandSchema,
  RestaurantAdministrationResultSchema,
} from './restaurantAdministration.js';
const id = '01991a00-0000-7000-8000-000000000711';
it('assignment contracts accept captured reference versions and preserve authoritative result fields', () => {
  const common = { commandId: id, productId: id, expectedVersion: 8, reason: 'Assign reference' };
  expect(
    TaxAdministrationCommandSchema.parse({
      ...common,
      kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
      profileId: id,
      profileVersion: 2,
    }),
  ).toMatchObject({ profileVersion: 2, expectedVersion: 8 });
  expect(
    RestaurantAdministrationCommandSchema.parse({
      ...common,
      kind: 'ASSIGN_PRODUCT_STATION',
      stationId: id,
      stationVersion: 3,
    }),
  ).toMatchObject({ stationVersion: 3 });
  for (const schema of [TaxAdministrationResultSchema, RestaurantAdministrationResultSchema]) {
    const result = {
      entityId: id,
      version: 9,
      catalogGeneration: 41,
      changed: true,
      recoveryEpoch: 1,
      reference: { kind: 'STATION', id, version: 3 },
    };
    expect(schema.parse(result)).toEqual(result);
  }
  expect(
    TaxAdministrationCommandSchema.safeParse({
      ...common,
      kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
      profileId: id,
      profileVersion: 0,
    }).success,
  ).toBe(false);
});
const command = {
  kind: 'UPDATE_PRODUCT_DETAILS',
  commandId: id,
  entityId: id,
  expectedVersion: 1,
  payload: { name: ' Product ', description: '', sku: null, barcode: null, displayOrder: 0 },
};
it('rejects client authority and cross-command field smuggling', () => {
  for (const field of ['tenantId', 'locationId', 'edgeId', 'actor', 'device', 'session'])
    expect(CatalogCommandSchema.safeParse({ ...command, [field]: id }).success).toBe(false);
  for (const field of [
    'basePrice',
    'taxProfile',
    'station',
    'category',
    'active',
    'available',
    'modifierGroups',
  ])
    expect(
      CatalogCommandSchema.safeParse({ ...command, payload: { ...command.payload, [field]: null } })
        .success,
    ).toBe(false);
});
it('normalizes commercial text and requires OCC and reason for price', () => {
  expect(CatalogCommandSchema.parse(command).payload).toMatchObject({ name: 'Product' });
  expect(CatalogCommandSchema.safeParse({ ...command, expectedVersion: 0 }).success).toBe(false);
  expect(
    CatalogCommandSchema.safeParse({
      kind: 'UPDATE_PRODUCT_PRICE',
      commandId: id,
      entityId: id,
      expectedVersion: 1,
      payload: { basePrice: { amount: 1, currency: 'MXN' } },
    }).success,
  ).toBe(false);
});
