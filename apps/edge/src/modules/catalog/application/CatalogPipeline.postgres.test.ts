import { beforeAll, afterAll, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  applyCatalogSchemaMigration,
  applyModifierQuantitySchemaMigration,
  applyModifierVersionSchemaMigration,
  readModifierAdministration,
  ensureCatalogBaseline,
  readCatalogState,
  CatalogRepository,
  TaxAdministrationRepository,
  RestaurantAdministrationRepository,
  EdgeControlRepository,
  SyncOutboxRepository,
  CloudSyncRepository,
  CloudProjectionRepository,
  createCloudDatabase,
  migrateCloudDatabase,
} from '@comanview/database';
import * as schema from '@comanview/database/edge';
import { BASE_ROLE_PERMISSIONS } from '@comanview/auth';
import { CatalogInvalidationController } from '@comanview/client-sdk';
import {
  CatalogCommandSchema,
  type CatalogChanged,
  type CatalogProjectedEntity,
  type TaxAdministrationResult,
} from '@comanview/contracts';
import {
  MemoryRecoverySecurityStore,
  initializeRecoverySecurityFloor,
  updateRecoverySecurityFloor,
} from '../../backup/RecoverySecurityStore.js';
import type { AuthService } from '../../auth/application/AuthService.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';
import { TaxAdministrationService } from '../../administration/TaxAdministrationService.js';
import { AdministrationService } from '../../administration/AdministrationService.js';
import { EdgeLicenseManager } from '../../licensing/EdgeLicenseManager.js';
import { CatalogService } from './CatalogService.js';
import { CatalogCommandService } from './CatalogCommandService.js';

// Existing opt-in PostgreSQL gate. Never use the acceptance lab or an operational DB.
const url = process.env['COMANVIEW_TEST_POSTGRES_URL'];
const databaseName = `catalog_pipeline_${randomUUID().replaceAll('-', '')}`;
const binding = { edgeId: randomUUID(), tenantId: randomUUID(), locationId: randomUUID() };
let cloud: ReturnType<typeof createCloudDatabase>, admin: ReturnType<typeof createCloudDatabase>;
let sqlite: Database.Database;
beforeAll(async () => {
  if (!url) return;
  admin = createCloudDatabase(url);
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  const isolated = new URL(url);
  isolated.pathname = `/${databaseName}`;
  cloud = createCloudDatabase(isolated.toString());
  await migrateCloudDatabase(isolated.toString());
});
afterAll(async () => {
  sqlite?.close();
  await cloud?.close();
  if (admin) {
    if (!/^catalog_pipeline_[a-f0-9]{32}$/.test(databaseName))
      throw new Error('Unsafe test database name');
    await admin.pool.query(`DROP DATABASE "${databaseName}"`);
    await admin.close();
  }
});

it.skipIf(!url).each([16, 18] as const)(
  'schema %s real command → Event/notification → client refresh → Outbox/Inbox/projection, including retry and new epoch',
  async (targetSchema) => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys=ON');
    const directory = fileURLToPath(new URL('../../../../../../migrations/edge/', import.meta.url));
    for (const name of readdirSync(directory)
      .filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) <= 15)
      .sort())
      sqlite.exec(readFileSync(join(directory, name), 'utf8'));
    const profile = randomUUID(),
      otherTax = randomUUID(),
      station = randomUUID(),
      legacyCategory = randomUUID();
    sqlite
      .prepare(
        "INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)",
      )
      .run(binding.edgeId, binding.tenantId, binding.locationId);
    for (const id of [profile, otherTax]) {
      sqlite
        .prepare(
          "INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,version) VALUES(?,'Tax',800,'TAX_ADDED',1)",
        )
        .run(id);
      sqlite.prepare("INSERT INTO tax_profile_revisions VALUES(?,1,800,'TAX_ADDED',1)").run(id);
    }
    sqlite
      .prepare(
        'INSERT INTO operational_configuration(tenant_id,location_id,currency,default_tax_profile_id,updated_at) VALUES(?,?,?,?,1)',
      )
      .run(binding.tenantId, binding.locationId, 'MXN', profile);
    sqlite
      .prepare("INSERT INTO stations(id,tenant_id,location_id,name) VALUES(?,?,?,'Kitchen')")
      .run(station, binding.tenantId, binding.locationId);
    sqlite
      .prepare("INSERT INTO categories(id,name,active) VALUES(?,'Category',1)")
      .run(legacyCategory);
    for (const sku of ['  abc ', 'ABC'])
      sqlite
        .prepare(
          "INSERT INTO products(id,name,category_id,tax_profile_id,base_price_amount,base_price_currency,sku) VALUES(?,'Legacy',?,?,100,'MXN',?)",
        )
        .run(randomUUID(), legacyCategory, profile, sku);
    applyCatalogSchemaMigration(sqlite);
    applyCatalogSchemaMigration(sqlite);
    expect(
      sqlite.prepare("SELECT state,product_id FROM catalog_sku_claims WHERE sku_key='ABC'").get(),
    ).toEqual({ state: 'CONFLICT', product_id: null });
    const system = (
      sqlite.prepare("SELECT id FROM categories WHERE system_key='UNCATEGORIZED'").get() as {
        id: string;
      }
    ).id;
    const store = new MemoryRecoverySecurityStore();
    await initializeRecoverySecurityFloor({ store, sqlite, binding });
    await store.mutate((f) => updateRecoverySecurityFloor(f, { minimumSchemaVersion: 16 }));
    const actor: AuthenticatedActor = {
      ...binding,
      userId: randomUUID(),
      deviceId: randomUUID(),
      sessionId: randomUUID(),
      displayName: 'Fixture',
      roles: ['OWNER'],
      permissions: [...BASE_ROLE_PERMISSIONS.OWNER],
    };
    // Application authorization seam; the real Floor read lease and SQL transaction are retained.
    // Real Auth/RBAC/session revalidation is covered separately by CatalogCommandHttp.
    const auth: Pick<AuthService, 'withCurrentAuthorization'> = {
      withCurrentAuthorization: (_actor, run) =>
        store.readConsistent((floor) => run(() => actor, floor)),
    };
    const orm = drizzle(sqlite, { schema }),
      reads = new CatalogService(new CatalogRepository(orm));
    const refresh = new CatalogInvalidationController(
      {
        getCatalogState: async () => readCatalogState(sqlite),
        getCategories: () => reads.getAllCategories(),
        getProducts: () => reads.getAllProducts(),
      },
      () => {},
    );
    const notices: CatalogChanged[] = [];
    const publish = (message: CatalogChanged) => {
      expect(sqlite.inTransaction).toBe(false);
      notices.push(message);
      refresh.invalidate(message);
    };
    const commands = new CatalogCommandService(sqlite, binding, auth, publish);
    const assignment = (result: TaxAdministrationResult) => {
      if (result.changed)
        publish({
          type: 'CATALOG_CHANGED',
          locationId: binding.locationId,
          capabilityVersion: 1,
          recoveryEpoch: result.recoveryEpoch!,
          catalogGeneration: result.catalogGeneration!,
          affectedTypes: ['PRODUCT'],
          affectedIds: [result.entityId],
          fullInvalidation: false,
        });
    };
    const tax = new TaxAdministrationService(
      new TaxAdministrationRepository(orm),
      binding,
      auth,
      assignment,
    );
    const licensing = new EdgeLicenseManager(
      new EdgeControlRepository(orm),
      null,
      {
        enforcementEnabled: false,
        publicKeyring: {},
        pullIntervalMs: 1,
        maxBackoffMs: 1,
        checkpointIntervalMs: 1,
      },
      binding,
    );
    const stations = new AdministrationService(
      new RestaurantAdministrationRepository(orm),
      binding,
      licensing,
      auth,
      assignment,
    );
    const outbox = new SyncOutboxRepository(orm),
      inbox = new CloudSyncRepository(cloud.db),
      projection = new CloudProjectionRepository(cloud.pool);
    await inbox.provisionEdge({ ...binding, credentialHash: 'test-only' });
    const workerId = randomUUID(),
      projectionVersion = 99;
    const transfer = async () => {
      const rows = outbox.claimBatch(100, 1000);
      if (rows.length) {
        const events = rows.map((row) => ({
          schemaVersion: 1 as const,
          eventId: row.id,
          eventType: row.eventType,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          aggregateVersion: row.aggregateVersion!,
          ...binding,
          localSequence: row.localSequence,
          recoveryEpoch: row.recoveryEpoch,
          occurredAt: row.occurredAt.toISOString(),
          payload: JSON.parse(row.payload),
        }));
        expect((await inbox.ingestBatch(randomUUID(), '1', events)).integrityRejected).toEqual([]);
        // Repeat transport without changing event IDs: lost ACK must remain idempotent.
        expect((await inbox.ingestBatch(randomUUID(), '1', events)).integrityRejected).toEqual([]);
        outbox.markSynced(rows.map((row) => row.id));
      }
      for (let i = 0; i < 100; i++) {
        const claimed = await projection.claimEvents({
          projectionVersion,
          workerId,
          limit: 100,
          leaseDurationMs: 1000,
        });
        if (!claimed.length) break;
        for (const event of claimed) {
          const beforeBaseline = event.eventType.startsWith('CATALOG_BASELINE_')
            ? await projection.readCatalog(projectionVersion, binding)
            : null;
          await projection.completeEvent({
            event,
            workerId,
            projectionVersion,
            action: { type: 'CATALOG' },
          });
          if (
            event.eventType.startsWith('CATALOG_BASELINE_') &&
            event.eventType !== 'CATALOG_BASELINE_COMPLETED'
          ) {
            const partial = await projection.readCatalog(projectionVersion, binding);
            if (event.recoveryEpoch === 0)
              expect(partial?.entities).toEqual(beforeBaseline?.entities);
            else expect(partial).toBeNull();
          }
        }
      }
      expect(await projection.countUnprocessed(projectionVersion)).toBe(0);
      await refresh.check();
      return projection.readCatalog(projectionVersion, binding);
    };
    ensureCatalogBaseline(sqlite, binding);
    const baseline = await transfer();
    expect(baseline.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'CATEGORY',
          state: expect.objectContaining({ id: legacyCategory, name: 'Category' }),
        }),
        expect.objectContaining({
          entityType: 'CATEGORY',
          state: expect.objectContaining({ id: system, systemKey: 'UNCATEGORIZED' }),
        }),
      ]),
    );
    const create = CatalogCommandSchema.parse({
      kind: 'CREATE_PRODUCT',
      commandId: randomUUID(),
      expectedVersion: 0,
      payload: { name: 'Pipeline', basePrice: { amount: 100, currency: 'MXN' } },
    });
    const created = await commands.execute(create, actor),
      productId = created.entityId!;
    const readProduct = (view: typeof baseline) =>
      (view.entities as CatalogProjectedEntity[]).find(
        (e) => e.entityType === 'PRODUCT' && e.state.id === productId,
      )?.state;
    expect(readProduct(await transfer())).toMatchObject({
      id: productId,
      version: 1,
      basePrice: { amount: 100 },
    });
    expect(refresh.getSnapshot()?.products.find((p) => p.id === productId)?.version).toBe(1);
    const price = CatalogCommandSchema.parse({
      kind: 'UPDATE_PRODUCT_PRICE',
      commandId: randomUUID(),
      entityId: productId,
      expectedVersion: 1,
      reason: 'Test',
      payload: { basePrice: { amount: 250, currency: 'MXN' } },
    });
    await commands.execute(price, actor);
    expect(readProduct(await transfer())).toMatchObject({ version: 2, basePrice: { amount: 250 } });
    expect(refresh.getSnapshot()?.products.find((p) => p.id === productId)?.basePrice.amount).toBe(
      250,
    );
    await tax.execute(
      {
        kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
        commandId: randomUUID(),
        productId,
        expectedVersion: 2,
        profileId: otherTax,
        profileVersion: 1,
        reason: 'Test',
      },
      actor,
    );
    expect(readProduct(await transfer())).toMatchObject({
      version: 3,
      taxProfileId: otherTax,
      taxProfileRevision: 1,
    });
    await stations.execute(
      {
        kind: 'ASSIGN_PRODUCT_STATION',
        commandId: randomUUID(),
        productId,
        expectedVersion: 3,
        stationId: station,
        stationVersion: 1,
        reason: 'Test',
      },
      actor,
    );
    const final = await transfer();
    expect(readProduct(final)).toMatchObject({ version: 4, stationId: station });
    const beforeNotices = notices.length,
      beforeEvents = sqlite.prepare('SELECT count(*) n FROM event_log').get();
    expect(await commands.execute(price, actor)).toMatchObject({ version: 2 });
    const noop = await commands.execute(
      CatalogCommandSchema.parse({
        kind: 'SET_PRODUCT_AVAILABILITY',
        commandId: randomUUID(),
        entityId: productId,
        expectedVersion: 4,
        payload: { available: true },
      }),
      actor,
    );
    expect(noop).toMatchObject({ changed: false, catalogGeneration: 4, version: 4 });
    expect(
      sqlite
        .prepare('SELECT command_id FROM catalog_command_receipts WHERE command_id=?')
        .get(noop.commandId),
    ).toBeTruthy();
    sqlite.exec(
      "CREATE TRIGGER reject_catalog_receipt BEFORE INSERT ON catalog_command_receipts BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    await expect(
      commands.execute(
        CatalogCommandSchema.parse({
          ...price,
          commandId: randomUUID(),
          expectedVersion: 4,
          payload: { basePrice: { amount: 300, currency: 'MXN' } },
        }),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    sqlite.exec('DROP TRIGGER reject_catalog_receipt');
    expect(notices).toHaveLength(beforeNotices);
    expect(sqlite.prepare('SELECT count(*) n FROM event_log').get()).toEqual(beforeEvents);
    expect(await transfer()).toEqual(final);
    let modifierFinal: Awaited<ReturnType<typeof transfer>> | undefined;
    if (targetSchema === 18) {
      applyModifierQuantitySchemaMigration(sqlite);
      applyModifierVersionSchemaMigration(sqlite);
      await store.mutate((f) => updateRecoverySecurityFloor(f, { minimumSchemaVersion: 18 }));
      const execute = (value: unknown) =>
        commands.execute(CatalogCommandSchema.parse(value), actor);
      const createdGroup = await execute({
        kind: 'CREATE_MODIFIER_GROUP',
        commandId: randomUUID(),
        expectedVersion: 0,
        payload: { name: 'Extras', minSelections: 0, maxSelections: 3, active: true },
      });
      const groupId = createdGroup.entityId!;
      const current = () => readModifierAdministration(sqlite).find((g) => g.id === groupId)!;
      const assertProjection = async () => {
        const view = await transfer(),
          group = current();
        expect(view.entities).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              entityType: 'MODIFIER_GROUP',
              state: expect.objectContaining({
                id: groupId,
                version: group.version,
                name: group.name,
                minSelections: group.minSelections,
                maxSelections: group.maxSelections,
                active: group.active,
              }),
            }),
            ...group.options.map((o) =>
              expect.objectContaining({ entityType: 'MODIFIER_OPTION', state: o }),
            ),
          ]),
        );
        return view;
      };
      await assertProjection();
      await execute({
        kind: 'UPDATE_MODIFIER_GROUP',
        commandId: randomUUID(),
        entityId: groupId,
        expectedVersion: current().version,
        payload: { name: 'Extras compartidos', minSelections: 0, maxSelections: 4, active: true },
      });
      await assertProjection();
      for (const [name, amount] of [
        ['Queso', 1500],
        ['Tocino', 2000],
      ] as const) {
        await execute({
          kind: 'CREATE_MODIFIER_OPTION',
          commandId: randomUUID(),
          expectedVersion: 0,
          group: { id: groupId, version: current().version },
          payload: {
            name,
            unitPriceDelta: { amount, currency: 'MXN' },
            active: true,
            available: true,
            displayOrder: current().options.length,
          },
        });
        await assertProjection();
      }
      const optionId = current().options[0]!.id;
      const currentOption = () => current().options.find((o) => o.id === optionId)!;
      const optionEdit = {
        kind: 'UPDATE_MODIFIER_OPTION',
        commandId: randomUUID(),
        entityId: optionId,
        expectedVersion: currentOption().version,
        group: { id: groupId, version: current().version },
        payload: {
          name: 'Sin queso',
          unitPriceDelta: { amount: -1000, currency: 'MXN' },
          active: true,
          available: true,
          displayOrder: 0,
        },
      };
      await execute(optionEdit);
      await assertProjection();
      await execute({
        kind: 'SET_MODIFIER_OPTION_AVAILABILITY',
        commandId: randomUUID(),
        entityId: optionId,
        expectedVersion: currentOption().version,
        group: { id: groupId, version: current().version },
        payload: { available: false },
      });
      await assertProjection();
      await execute({
        kind: 'SET_MODIFIER_OPTION_ACTIVE',
        commandId: randomUUID(),
        entityId: optionId,
        expectedVersion: currentOption().version,
        group: { id: groupId, version: current().version },
        payload: { active: false },
      });
      await assertProjection();
      await execute({
        kind: 'REORDER_MODIFIER_OPTIONS',
        commandId: randomUUID(),
        entityId: groupId,
        expectedVersion: current().version,
        payload: {
          options: [...current().options]
            .reverse()
            .map((o, displayOrder) => ({ id: o.id, expectedVersion: o.version, displayOrder })),
        },
      });
      await assertProjection();
      const assign = {
        kind: 'SET_PRODUCT_MODIFIERS',
        commandId: randomUUID(),
        entityId: productId,
        expectedVersion: 4,
        payload: {
          assignments: [
            {
              groupId,
              groupVersion: current().version,
              displayOrder: 0,
              overrides: { [optionId]: { amount: 500, currency: 'MXN' } },
            },
          ],
        },
      };
      await execute(assign);
      expect(readProduct(await transfer())).toMatchObject({
        version: 5,
        modifierAssignments: [
          { groupId, displayOrder: 0, overrides: { [optionId]: { amount: 500, currency: 'MXN' } } },
        ],
      });
      await execute(assign);
      expect(readProduct(await transfer())).toMatchObject({ version: 5 });
      ensureCatalogBaseline(sqlite, binding);
      expect(readProduct(await assertProjection())).toMatchObject({
        version: 5,
        modifierAssignments: [
          { groupId, displayOrder: 0, overrides: { [optionId]: { amount: 500, currency: 'MXN' } } },
        ],
      });
      await execute({
        ...assign,
        commandId: randomUUID(),
        expectedVersion: 5,
        payload: { assignments: [{ ...assign.payload.assignments[0]!, overrides: {} }] },
      });
      expect(readProduct(await transfer())).toMatchObject({
        version: 6,
        modifierAssignments: [{ groupId, displayOrder: 0, overrides: {} }],
      });
      await execute({
        ...assign,
        commandId: randomUUID(),
        expectedVersion: 6,
        payload: { assignments: [] },
      });
      expect(readProduct(await transfer())).toMatchObject({ version: 7, modifierAssignments: [] });
      await execute({
        kind: 'SET_MODIFIER_GROUP_ACTIVE',
        commandId: randomUUID(),
        entityId: groupId,
        expectedVersion: current().version,
        payload: { active: false },
      });
      modifierFinal = await assertProjection();
      // Old command receipt and duplicate transport cannot roll projection versions back.
      await execute(optionEdit);
      expect(await transfer()).toEqual(modifierFinal);
      ensureCatalogBaseline(sqlite, binding);
      modifierFinal = await assertProjection();
      const generation = readCatalogState(sqlite).catalogGeneration;
      ensureCatalogBaseline(sqlite, binding);
      expect(readCatalogState(sqlite).catalogGeneration).toBe(generation);
    }
    // Model the already validated restore boundary; encrypted physical restore has its own lifecycle tests.
    sqlite.exec(
      'UPDATE edge_installations SET recovery_epoch=1;UPDATE catalog_state SET generation=0',
    );
    await store.mutate((f) => updateRecoverySecurityFloor(f, { recoveryEpoch: 1 }));
    await expect(commands.execute(price, actor)).rejects.toMatchObject({
      code: 'COMMAND_ID_CONFLICT',
    });
    ensureCatalogBaseline(sqlite, binding);
    expect((await transfer()).generation).toBe('0');
    expect(refresh.getSnapshot()?.state).toMatchObject({ recoveryEpoch: 1, catalogGeneration: 0 });
    expect(readProduct(await projection.readCatalog(projectionVersion, binding))).toMatchObject({
      version: targetSchema === 18 ? 7 : 4,
      stationId: station,
    });
    if (modifierFinal) {
      const view = await projection.readCatalog(projectionVersion, binding);
      const modifiers = (entities: CatalogProjectedEntity[]) =>
        entities.filter(
          (e) => e.entityType === 'MODIFIER_GROUP' || e.entityType === 'MODIFIER_OPTION',
        );
      expect(modifiers(view.entities)).toEqual(modifiers(modifierFinal.entities));
      // Fresh worker repository/projection version replays all persisted Inbox events.
      const restarted = new CloudProjectionRepository(cloud.pool),
        replayVersion = 100,
        replayWorker = randomUUID();
      for (let i = 0; i < 100; i++) {
        const events = await restarted.claimEvents({
          projectionVersion: replayVersion,
          workerId: replayWorker,
          limit: 100,
          leaseDurationMs: 1000,
        });
        if (!events.length) break;
        for (const event of events)
          await restarted.completeEvent({
            event,
            workerId: replayWorker,
            projectionVersion: replayVersion,
            action: { type: 'CATALOG' },
          });
      }
      expect(await restarted.countUnprocessed(replayVersion)).toBe(0);
      expect(await restarted.readCatalog(replayVersion, binding)).toEqual(view);
    }
    refresh.stop();
  },
);
