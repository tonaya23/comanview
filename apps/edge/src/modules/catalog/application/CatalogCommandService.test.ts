import { afterEach, beforeEach, expect, it,vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@comanview/database/edge';
import {
  TaxAdministrationRepository,
  RestaurantAdministrationRepository,
  CatalogRepository,
  EdgeControlRepository,
  ensureCatalogBaseline,readCatalogState,SyncOutboxRepository,
} from '@comanview/database';
import type {
  TaxAdministrationCommand,
  RestaurantAdministrationCommand,
} from '@comanview/contracts';
import { TaxAdministrationService } from '../../administration/TaxAdministrationService.js';
import { AdministrationService } from '../../administration/AdministrationService.js';
import { EdgeLicenseManager } from '../../licensing/EdgeLicenseManager.js';
import type { AuthService } from '../../auth/application/AuthService.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID as id } from 'node:crypto';
import { applyCatalogSchemaMigration, validateCatalogBaseline } from '@comanview/database';
import {
  CatalogCommandSchema,
  type CatalogCommandInput,
  type CatalogCommandResult,
} from '@comanview/contracts';
import { BASE_ROLE_PERMISSIONS } from '@comanview/auth';
import {
  MemoryRecoverySecurityStore,
  initializeRecoverySecurityFloor,
  updateRecoverySecurityFloor,
} from '../../backup/RecoverySecurityStore.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';
import { CatalogCommandService } from './CatalogCommandService.js';
import { AppError } from '../../../app/errorHandler.js';
import { EntityId } from '@comanview/domain';

let db: Database.Database,
  store: MemoryRecoverySecurityStore,
  service: CatalogCommandService,
  actor: AuthenticatedActor,
  active: boolean,
  profileId: string,
  stationId: string;
let taxService: TaxAdministrationService, stationService: AdministrationService;
const published=vi.fn();
const binding = { edgeId: id(), tenantId: id(), locationId: id() };
beforeEach(async () => {
  published.mockReset();published.mockImplementation(()=>expect(db.inTransaction).toBe(false));
  db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  const root = fileURLToPath(new URL('../../../../../../migrations/edge/', import.meta.url));
  for (const name of readdirSync(root)
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) <= 15)
    .sort())
    db.exec(readFileSync(join(root, name), 'utf8'));
  applyCatalogSchemaMigration(db);
  profileId = id();
  stationId = id();
  active = true;
  db.prepare(
    "INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)",
  ).run(binding.edgeId, binding.tenantId, binding.locationId);
  db.prepare(
    "INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,version) VALUES(?,'IVA',800,'TAX_ADDED',1)",
  ).run(profileId);
  db.prepare(
    "INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at) VALUES(?,1,800,'TAX_ADDED',1)",
  ).run(profileId);
  db.prepare(
    'INSERT INTO operational_configuration(tenant_id,location_id,currency,default_tax_profile_id,updated_at) VALUES(?,?,?,?,1)',
  ).run(binding.tenantId, binding.locationId, 'MXN', profileId);
  db.prepare("INSERT INTO stations(id,tenant_id,location_id,name) VALUES(?,?,?,'Kitchen')").run(
    stationId,
    binding.tenantId,
    binding.locationId,
  );
  actor = {
    userId: id(),
    deviceId: id(),
    sessionId: id(),
    tenantId: binding.tenantId,
    locationId: binding.locationId,
    displayName: 'Fixture',
    roles: ['OWNER'],
    permissions: [...BASE_ROLE_PERMISSIONS.OWNER],
  };
  store = new MemoryRecoverySecurityStore();
  await initializeRecoverySecurityFloor({ store, sqlite: db, binding });
  await store.mutate((f) => updateRecoverySecurityFloor(f, { minimumSchemaVersion: 16 }));
  // Unit seam supplies changing authorization; the real Floor lease and SQL remain intact.
  const auth: Pick<AuthService, 'withCurrentAuthorization'> = {
    withCurrentAuthorization: (_actor, run) =>
      store.readConsistent((floor) =>
        run(() => {
          if (!active) throw new AppError('AUTH_SESSION_INVALID', 401, 'Expired');
          return actor;
        }, floor),
      ),
  };
  service = new CatalogCommandService(db, binding, auth,published);
  const orm = drizzle(db, { schema });
  taxService = new TaxAdministrationService(new TaxAdministrationRepository(orm), binding, auth,published);
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
  stationService = new AdministrationService(
    new RestaurantAdministrationRepository(orm),
    binding,
    licensing,
    auth,
    published,
  );
});
afterEach(() => db.close());
it('catalog notifies only committed effective mutations, not no-op, receipt replay or rollback',async()=>{
 const p=await create();expect(published).toHaveBeenCalledTimes(1);expect(published.mock.calls[0]?.[0]).toMatchObject({type:'CATALOG_CHANGED',catalogGeneration:1,recoveryEpoch:0,affectedIds:[p.entityId]});
 expect(JSON.parse((db.prepare('SELECT payload FROM event_log WHERE command_id=?').get(p.commandId) as {payload:string}).payload)).toMatchObject({entityId:p.entityId,entityVersion:1,catalogGeneration:1,entities:[{entityType:'PRODUCT',state:{id:p.entityId}}]});
 expect(await mutate(p,true)).toMatchObject({changed:false});expect(published).toHaveBeenCalledTimes(1);
 const command={kind:'SET_PRODUCT_AVAILABILITY' as const,commandId:id(),entityId:p.entityId!,expectedVersion:1,payload:{available:false}};
 await execute(command);await execute(command);expect(published).toHaveBeenCalledTimes(2);
 db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON event_log BEGIN SELECT RAISE(ABORT,'event failure'); END");
 await expect(create()).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(published).toHaveBeenCalledTimes(2);expect(readCatalogState(db).catalogGeneration).toBe(2);
});
it('notification failure does not fail the acknowledged mutation; assignment notifications are also post-commit',async()=>{
 published.mockImplementation(()=>{expect(db.inTransaction).toBe(false);throw new Error('socket unavailable');});
 const p=await create();expect(p.version).toBe(1);await reviseTax();await assignTax(taxCommand(p.entityId!,1,2));await assignStation(stationCommand(p.entityId!,2));
 expect(readCatalogState(db)).toMatchObject({catalogGeneration:3});expect(published).toHaveBeenCalledTimes(3);
});
it('baseline is durable, chunked and restart-idempotent; restore re-envelope requires a fresh capture',async()=>{
 await create();ensureCatalogBaseline(db,binding);
 const events=()=>db.prepare("SELECT * FROM event_log WHERE event_type LIKE 'CATALOG_BASELINE_%' ORDER BY local_sequence").all() as {payload:string;local_sequence:number;recovery_epoch:number}[];
 const first=events();expect(first).toHaveLength(3);expect(JSON.parse(first[1]!.payload).entities).toHaveLength(2);
 ensureCatalogBaseline(db,binding);expect(events()).toEqual(first);
 db.exec("UPDATE edge_installations SET recovery_epoch=1;UPDATE event_log SET recovery_epoch=1 WHERE sync_status='PENDING'");
 ensureCatalogBaseline(db,binding);expect(events()).toHaveLength(6);expect(JSON.parse(events()[4]!.payload).sourceEpoch).toBe(1);expect(JSON.parse(events()[4]!.payload).baselineId).not.toBe(JSON.parse(first[1]!.payload).baselineId);
});
it('baseline failure rolls back every chunk and can retry without partial evidence',async()=>{
 await create();db.exec("CREATE TRIGGER fail_baseline BEFORE INSERT ON event_log WHEN NEW.event_type='CATALOG_BASELINE_COMPLETED' BEGIN SELECT RAISE(ABORT,'failure'); END");
 expect(()=>ensureCatalogBaseline(db,binding)).toThrow();expect(db.prepare("SELECT count(*) n FROM event_log WHERE event_type LIKE 'CATALOG_BASELINE_%'").get()).toEqual({n:0});
 db.exec('DROP TRIGGER fail_baseline');ensureCatalogBaseline(db,binding);expect(db.prepare("SELECT count(*) n FROM event_log WHERE event_type LIKE 'CATALOG_BASELINE_%'").get()).toEqual({n:3});
});
it('baseline chunks and outbox batches stay bounded and preserve ordering for large captures',async()=>{
 const categoryId=(db.prepare('SELECT id FROM categories').get() as {id:string}).id;
 const insert=db.prepare("INSERT INTO products(id,name,description,category_id,tax_profile_id,base_price_amount,base_price_currency) VALUES(?,'Bulk',?,?,?,1,'MXN')");
 db.transaction(()=>{for(let i=0;i<220;i++)insert.run(id(),'x'.repeat(4000),categoryId,profileId);})();
 ensureCatalogBaseline(db,binding);const chunks=db.prepare("SELECT payload FROM event_log WHERE event_type='CATALOG_BASELINE_CHUNK'").all() as {payload:string}[];
 expect(chunks.length).toBeGreaterThan(2);expect(chunks.every(c=>Buffer.byteLength(c.payload)<140000)).toBe(true);
 const outbox=new SyncOutboxRepository(drizzle(db,{schema}));let count=0,last=0;
 while(true){const batch=outbox.claimBatch(100,1000);if(!batch.length)break;expect(batch.reduce((sum,e)=>sum+Buffer.byteLength(e.payload)+2048,0)).toBeLessThanOrEqual(750000);for(const e of batch){expect(e.localSequence).toBeGreaterThan(last);last=e.localSequence;}count+=batch.length;outbox.markSynced(batch.map(e=>e.id));}
 expect(count).toBe(chunks.length+2);
});
it('receipts cannot cross recovery epochs or authenticated identities', async () => {
  const command = {
    kind: 'CREATE_CATEGORY' as const,
    commandId: id(),
    expectedVersion: 0 as const,
    payload: { name: 'Before restore' },
  };
  await execute(command);
  actor.sessionId = id();
  await expect(execute(command)).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  await store.mutate((f) => updateRecoverySecurityFloor(f, { recoveryEpoch: 1 }));
  db.exec('UPDATE edge_installations SET recovery_epoch=1');
  await expect(execute(command)).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  expect(generation()).toEqual({ generation: 1 });
});
it('permits an authorized non-default tax and denies it after specialized privilege removal', async () => {
  const other = id();
  db.prepare(
    "INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,version) VALUES(?,'Other',1600,'TAX_ADDED',1)",
  ).run(other);
  db.prepare(
    "INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at) VALUES(?,1,1600,'TAX_ADDED',1)",
  ).run(other);
  const command = {
    kind: 'CREATE_PRODUCT' as const,
    commandId: id(),
    expectedVersion: 0 as const,
    payload: {
      name: 'Other tax',
      basePrice: { amount: 100, currency: 'MXN' },
      taxProfile: { id: other, version: 1 },
    },
  };
  expect((await execute(command)).entities[0]).toMatchObject({ taxProfileId: other });
  actor.permissions = actor.permissions.filter((permission) => permission !== 'TAX_PROFILE_MANAGE');
  await expect(execute(command)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  expect((await create()).entities[0]).toMatchObject({ taxProfileId: profileId });
});
const execute = (command: CatalogCommandInput) =>
  service.execute(CatalogCommandSchema.parse(command), actor);
const create = (
  payload: Partial<Extract<CatalogCommandInput, { kind: 'CREATE_PRODUCT' }>['payload']> = {},
) =>
  execute({
    kind: 'CREATE_PRODUCT',
    commandId: id(),
    expectedVersion: 0,
    payload: { name: 'Product', basePrice: { amount: 100, currency: 'MXN' }, ...payload },
  });
const category = () =>
  execute({
    kind: 'CREATE_CATEGORY',
    commandId: id(),
    expectedVersion: 0,
    payload: { name: 'Food' },
  });
const mutate = (r: CatalogCommandResult, available: boolean, commandId: string = id()) =>
  execute({
    commandId,
    kind: 'SET_PRODUCT_AVAILABILITY',
    entityId: r.entityId!,
    expectedVersion: r.version!,
    payload: { available },
  });
const generation = () => db.prepare('SELECT generation FROM catalog_state').get();

const taxCommand = (
  productId: string,
  expectedVersion = 1,
  profileVersion = 1,
): Extract<TaxAdministrationCommand, { kind: 'ASSIGN_PRODUCT_TAX_PROFILE' }> => ({
  kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
  commandId: id(),
  productId,
  expectedVersion,
  profileId,
  profileVersion,
  reason: 'Assign current tax',
});
const stationCommand = (
  productId: string,
  expectedVersion = 1,
  station: string | null = stationId,
): Extract<RestaurantAdministrationCommand, { kind: 'ASSIGN_PRODUCT_STATION' }> => ({
  kind: 'ASSIGN_PRODUCT_STATION',
  commandId: id(),
  productId,
  expectedVersion,
  stationId: station,
  ...(station ? { stationVersion: 1 } : {}),
  reason: 'Assign station',
});
const assignTax = (c: TaxAdministrationCommand) =>
  Promise.resolve().then(() => taxService.execute(c, actor));
const assignStation = (c: RestaurantAdministrationCommand) =>
  Promise.resolve().then(() => stationService.execute(c, actor));
const reviseTax = () =>
  taxService.execute(
    {
      kind: 'REVISE_TAX_PROFILE',
      commandId: id(),
      profileId,
      expectedVersion: 1,
      reason: 'Revise tax',
      name: 'IVA',
      rateBasisPoints: 1600,
      calculationMode: 'TAX_ADDED',
    },
    actor,
  );
const details = (p: CatalogCommandResult) =>
  execute({
    kind: 'UPDATE_PRODUCT_DETAILS',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    payload: { name: 'New name', description: '', sku: null, barcode: null, displayOrder: 0 },
  });
const evidence = () =>
  Object.fromEntries(
    [
      'products',
      'catalog_state',
      'audit_log',
      'event_log',
      'administration_command_receipts',
      'processed_commands',
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  );

it('Tax changes one shared version/generation with specialized Audit, explicit event and durable retry', async () => {
  const p = await create();
  await reviseTax();
  const c = taxCommand(p.entityId!, 1, 2),
    r = await assignTax(c);
  expect(r).toMatchObject({
    entityId: p.entityId,
    version: 2,
    catalogGeneration: 2,
    changed: true,
    recoveryEpoch: 0,
    reference: { kind: 'TAX_PROFILE', id: profileId, version: 2 },
  });
  const before = evidence();
  expect(await assignTax(c)).toEqual(r);
  expect(evidence()).toEqual(before);
  const event = db.prepare('SELECT * FROM event_log WHERE command_id=?').get(c.commandId) as {
    id: string;
    event_type: string;
    payload: string;
    recovery_epoch: number;
    local_sequence: number;
  };
  expect(event.event_type).toBe('CATALOG_PRODUCT_TAX_ASSIGNED');
  expect(event.recovery_epoch).toBe(0);
  expect(event.local_sequence).toBeGreaterThan(0);
  expect(JSON.parse(event.payload)).toMatchObject({
    payloadVersion: 1,
    entityVersion: 2,
    catalogGeneration: 2,
    entities:[{entityType:'PRODUCT',state:{taxProfileId:profileId,taxProfileRevision:2}}],
    ...binding,
  });
  expect(
    db.prepare('SELECT action,event_id FROM audit_log WHERE command_id=?').get(c.commandId),
  ).toEqual({ action: 'TAX_CONFIGURATION_CHANGED', event_id: event.id });
  await expect(assignTax({ ...c, profileVersion: 1 })).rejects.toMatchObject({
    code: 'COMMAND_ID_CONFLICT',
  });
  await expect(details(p)).rejects.toMatchObject({ code: 'CATALOG_VERSION_CONFLICT' });
});
it('same tax/revision is a receipt-only no-op and stale tax reference fails without writes', async () => {
  const p = await create(),
    before = evidence(),
    c = taxCommand(p.entityId!);
  expect(await assignTax(c)).toMatchObject({ version: 1, catalogGeneration: 1, changed: false });
  expect(evidence()['products']).toEqual(before['products']);
  expect(evidence()['event_log']).toEqual(before['event_log']);
  expect(evidence()['audit_log']).toEqual(before['audit_log']);
  await reviseTax();
  const state = evidence();
  await expect(assignTax(taxCommand(p.entityId!))).rejects.toMatchObject({
    code: 'CATALOG_REFERENCE_CHANGED',
  });
  expect(evidence()).toEqual(state);
});
it('Catalog and Admin command IDs cannot collide in either direction', async () => {
  const p = await create();
  await expect(
    assignTax({ ...taxCommand(p.entityId!), commandId: p.commandId }),
  ).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  const command = stationCommand(p.entityId!);
  await assignStation(command);
  await expect(mutate({ ...p, version: 2 }, false, command.commandId)).rejects.toMatchObject({
    code: 'COMMAND_ID_CONFLICT',
  });
});
it('current default creation and explicit assignment capture the same immutable Tax revision', async () => {
  const old = await create();
  await reviseTax();
  const fresh = await create();
  expect(fresh.entities[0]).toMatchObject({
    taxProfileId: profileId,
    taxProfileRevision: 2,
    version: 1,
  });
  expect((await assignTax(taxCommand(old.entityId!, 1, 2))).reference).toEqual({
    kind: 'TAX_PROFILE',
    id: profileId,
    version: 2,
  });
});
it('Catalog price then stale Tax fails with safe version details', async () => {
  const p = await create();
  await execute({
    kind: 'UPDATE_PRODUCT_PRICE',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: 1,
    reason: 'New price',
    payload: { basePrice: { amount: 200, currency: 'MXN' } },
  });
  await expect(assignTax(taxCommand(p.entityId!))).rejects.toMatchObject({
    code: 'CATALOG_VERSION_CONFLICT',
    details: { entityId: p.entityId, expectedVersion: 1, actualVersion: 2 },
  });
});
it('Catalog category then stale Station fails; Station then stale Catalog fails', async () => {
  const p = await create(),
    cat = await category();
  await execute({
    kind: 'ASSIGN_PRODUCT_CATEGORY',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: 1,
    payload: { category: { id: cat.entityId!, version: 1 } },
  });
  await expect(assignStation(stationCommand(p.entityId!))).rejects.toMatchObject({
    code: 'CATALOG_VERSION_CONFLICT',
  });
  const r = await assignStation(stationCommand(p.entityId!, 2));
  expect(r).toMatchObject({ version: 3, catalogGeneration: 4 });
  await expect(mutate({ ...p, version: 2 }, false)).rejects.toMatchObject({
    code: 'CATALOG_VERSION_CONFLICT',
  });
});
it('Station assign/clear/no-op share version, generation and single specialized evidence', async () => {
  const p = await create(),
    c = stationCommand(p.entityId!),
    r = await assignStation(c),
    before = evidence();
  expect(r).toMatchObject({
    version: 2,
    catalogGeneration: 2,
    changed: true,
    reference: { kind: 'STATION', id: stationId, version: 1 },
  });
  expect(await assignStation(c)).toEqual(r);
  expect(evidence()).toEqual(before);
  expect(await assignStation(stationCommand(p.entityId!, 2))).toMatchObject({
    version: 2,
    catalogGeneration: 2,
    changed: false,
  });
  expect(await assignStation(stationCommand(p.entityId!, 2, null))).toMatchObject({
    version: 3,
    catalogGeneration: 3,
    changed: true,
    reference: { id: null, version: null },
  });
  expect(await assignStation(stationCommand(p.entityId!, 3, null))).toMatchObject({
    version: 3,
    catalogGeneration: 3,
    changed: false,
  });
  expect(
    db
      .prepare(
        "SELECT count(*) n FROM event_log WHERE event_type='CATALOG_PRODUCT_STATION_ASSIGNED'",
      )
      .get(),
  ).toEqual({ n: 2 });
  expect(
    db
      .prepare("SELECT count(*) n FROM audit_log WHERE action='RESTAURANT_ADMINISTRATION_CHANGED'")
      .get(),
  ).toEqual({ n: 2 });
});
it.each(['tax-first', 'station-first'])(
  'Tax/Station same-version writers: exactly one winner and retry (%s)',
  async (first) => {
    const p = await create();
    await reviseTax();
    const t = taxCommand(p.entityId!, 1, 2),
      s = stationCommand(p.entityId!);
    const calls =
      first === 'tax-first'
        ? [() => assignTax(t), () => assignStation(s)]
        : [() => assignStation(s), () => assignTax(t)];
    const results = await Promise.allSettled(calls.map((f) => f()));
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
      code: 'CATALOG_VERSION_CONFLICT',
    });
    const before = evidence();
    await calls[0]!();
    expect(evidence()).toEqual(before);
    expect(generation()).toEqual({ generation: 2 });
  },
);
it.each(['Tax', 'Station'])(
  '%s requires specialized permission even on receipt retry',
  async (kind) => {
    const p = await create(),
      c = kind === 'Tax' ? taxCommand(p.entityId!) : stationCommand(p.entityId!);
    const call = () =>
      kind === 'Tax'
        ? assignTax(c as TaxAdministrationCommand)
        : assignStation(c as RestaurantAdministrationCommand);
    await call();
    actor.permissions = actor.permissions.filter(
      (p) => p !== (kind === 'Tax' ? 'TAX_PROFILE_MANAGE' : 'STATION_MANAGE'),
    );
    const before = evidence();
    await expect(call()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(evidence()).toEqual(before);
  },
);
it.each(['Tax', 'Station'])(
  '%s revalidates session and epoch before receipt replay',
  async (kind) => {
    const p = await create(),
      c = kind === 'Tax' ? taxCommand(p.entityId!) : stationCommand(p.entityId!);
    const call = () =>
      kind === 'Tax'
        ? assignTax(c as TaxAdministrationCommand)
        : assignStation(c as RestaurantAdministrationCommand);
    await call();
    active = false;
    await expect(call()).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });
    active = true;
    db.exec('UPDATE edge_installations SET recovery_epoch=1');
    await store.mutate((f) => updateRecoverySecurityFloor(f, { recoveryEpoch: 1 }));
    await expect(call()).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  },
);
it.each(['audit_log', 'event_log', 'administration_command_receipts'])(
  'assignment failure in %s rolls back Product/generation/evidence',
  async (table) => {
    const p = await create();
    await reviseTax();
    const before = evidence();
    db.exec(
      `CREATE TRIGGER fail_assignment BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    await expect(assignTax(taxCommand(p.entityId!, 1, 2))).rejects.toThrow();
    expect(evidence()).toEqual(before);
    await expect(assignStation(stationCommand(p.entityId!))).rejects.toThrow();
    expect(evidence()).toEqual(before);
  },
);
it('rejects missing/inactive/cross-binding/stale Station and inactive Tax before mutation', async () => {
  const p = await create();
  await expect(assignStation(stationCommand(p.entityId!, 1, id()))).rejects.toMatchObject({
    code: 'STATION_REQUIRED',
  });
  db.exec('UPDATE stations SET version=2');
  await expect(assignStation(stationCommand(p.entityId!))).rejects.toMatchObject({
    code: 'CATALOG_REFERENCE_CHANGED',
  });
  db.prepare('UPDATE stations SET tenant_id=?').run(id());
  await expect(assignStation(stationCommand(p.entityId!))).rejects.toMatchObject({
    code: 'STATION_REQUIRED',
  });
  db.prepare('UPDATE stations SET tenant_id=?,active=0').run(binding.tenantId);
  await expect(assignStation(stationCommand(p.entityId!))).rejects.toMatchObject({
    code: 'STATION_REQUIRED',
  });
  db.exec('UPDATE tax_profiles SET active=0');
  await expect(assignTax(taxCommand(p.entityId!))).rejects.toMatchObject({
    code: 'TAX_PROFILE_INACTIVE',
  });
  expect(generation()).toEqual({ generation: 1 });
});

function item(product: string, send: 'DRAFT' | 'SENT', status = 'OPEN', prep = 'READY') {
  const order = id();
  db.prepare(
    "INSERT INTO orders(id,tenant_id,location_id,order_type,order_channel,order_number,currency,status,version,created_at) VALUES(?,?,?,'COUNTER','POS',?,'MXN',?,1,1)",
  ).run(order, binding.tenantId, binding.locationId, id(), status);
  db.prepare(
    "INSERT INTO order_items(id,order_id,product_id,product_name,base_price_amount,base_price_currency,tax_rate_basis_points,tax_calculation_mode,station_id,send_status,prep_status) VALUES(?,?,?,'Captured',100,'MXN',800,'TAX_ADDED',?,?,?)",
  ).run(id(), order, product, stationId, send, prep);
}
it('product Tax/Station changes leave DRAFT, SENT, CLOSED snapshots/routing byte-for-byte unchanged', async () => {
  const p = await create({ station: { id: stationId, version: 1 } });
  item(p.entityId!, 'DRAFT');
  item(p.entityId!, 'SENT');
  item(p.entityId!, 'SENT', 'CLOSED');
  const before = db.prepare('SELECT * FROM order_items').all();
  await reviseTax();
  await assignTax(taxCommand(p.entityId!, 1, 2));
  await assignStation(stationCommand(p.entityId!, 2, null));
  expect(db.prepare('SELECT * FROM order_items').all()).toEqual(before);
});
it('pending work forbids routing change, not a semantic Station no-op', async () => {
  const p = await create({ station: { id: stationId, version: 1 } });
  item(p.entityId!, 'SENT', 'OPEN', 'PENDING');
  expect(await assignStation(stationCommand(p.entityId!))).toMatchObject({
    changed: false,
    version: 1,
  });
  await expect(assignStation(stationCommand(p.entityId!, 1, null))).rejects.toMatchObject({
    code: 'STATION_HAS_PENDING_WORK',
  });
  expect(generation()).toEqual({ generation: 1 });
});
it('legacy saveProduct cannot bypass a commercial Product version', async () => {
  const p = await create(),
    repo = new CatalogRepository(drizzle(db, { schema }));
  const product = repo.getProductById(EntityId.fromString(p.entityId!));
  expect(product).toBeDefined();
  expect(() => repo.saveProduct(product!)).toThrow('CLIENT_CAPABILITY_REQUIRED');
  expect(generation()).toEqual({ generation: 1 });
});

it('creates with authoritative defaults and exact versions; never creates another category', async () => {
  const r = await create();
  expect(r).toMatchObject({ version: 1, changed: true, catalogGeneration: 1, recoveryEpoch: 0 });
  expect(r.entities[0]).toMatchObject({
    taxProfileId: profileId,
    taxProfileRevision: 1,
    stationId: null,
    basePrice: { amount: 100, currency: 'MXN' },
  });
  expect(db.prepare('SELECT count(*) n FROM categories').get()).toEqual({ n: 1 });
  validateCatalogBaseline(db);
});
it('uses explicit references, checks revision and specialized permissions', async () => {
  const c = await category();
  await create({
    category: { id: c.entityId!, version: 1 },
    taxProfile: { id: profileId, version: 1 },
    station: { id: stationId, version: 1 },
  });
  await expect(create({ category: { id: c.entityId!, version: 2 } })).rejects.toMatchObject({
    code: 'CATALOG_REFERENCE_CHANGED',
  });
  await expect(create({ taxProfile: { id: profileId, version: 2 } })).rejects.toMatchObject({
    code: 'CATALOG_REFERENCE_CHANGED',
  });
  actor.permissions = actor.permissions.filter((p) => p !== 'STATION_MANAGE');
  await expect(create({ station: { id: stationId, version: 1 } })).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  });
  db.prepare('UPDATE operational_configuration SET default_tax_profile_id=NULL').run();
  actor.permissions = actor.permissions.filter((p) => p !== 'TAX_PROFILE_MANAGE');
  await expect(create({ taxProfile: { id: profileId, version: 1 } })).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  });
});
it.each(['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const)(
  'enforces current %s permission policy',
  async (role) => {
    actor.roles = [role];
    actor.permissions = [...BASE_ROLE_PERMISSIONS[role]];
    if (role === 'OWNER' || role === 'MANAGER') expect((await create()).changed).toBe(true);
    else await expect(create()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  },
);
it('replays lost ACK without version/generation/audit duplication; rechecks authorization and intent', async () => {
  const command = {
    kind: 'CREATE_PRODUCT' as const,
    commandId: id(),
    expectedVersion: 0 as const,
    payload: { name: 'ACK', basePrice: { amount: 100, currency: 'MXN' } },
  };
  const first = await execute(command);
  expect(await execute(command)).toEqual(first);
  expect(generation()).toEqual({ generation: 1 });
  expect(db.prepare('SELECT count(*) n FROM audit_log').get()).toEqual({ n: 1 });
  await expect(
    execute({ ...command, payload: { ...command.payload, name: 'Different' } }),
  ).rejects.toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  actor.permissions = [];
  await expect(execute(command)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  active = false;
  await expect(execute(command)).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });
});
it('rejects two logical writers using the same version, including stale no-ops', async () => {
  const p = await create();
  const next = await mutate(p, false);
  expect(next.version).toBe(2);
  await expect(mutate(p, true)).rejects.toMatchObject({
    code: 'CATALOG_VERSION_CONFLICT',
    details: { expectedVersion: 1, actualVersion: 2 },
  });
  const noop = await mutate(next, false);
  expect(noop).toMatchObject({ changed: false, version: 2, catalogGeneration: 2 });
});
it('details, SKU transitions, category, price and active remain independent', async () => {
  let p = await create({ sku: 'abc' });
  const c = await category();
  p = await execute({
    kind: 'UPDATE_PRODUCT_DETAILS',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    payload: { name: 'New', description: 'Text', sku: 'xyz', barcode: null, displayOrder: 4 },
  });
  expect(db.prepare('SELECT sku_key FROM catalog_sku_claims').all()).toEqual([{ sku_key: 'XYZ' }]);
  p = await execute({
    kind: 'ASSIGN_PRODUCT_CATEGORY',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    payload: { category: { id: c.entityId!, version: 1 } },
  });
  p = await execute({
    kind: 'UPDATE_PRODUCT_PRICE',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    reason: 'Price review',
    payload: { basePrice: { amount: 250, currency: 'MXN' } },
  });
  const priceNoop = await execute({
    kind: 'UPDATE_PRODUCT_PRICE',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    reason: 'Check',
    payload: { basePrice: { amount: 250, currency: 'MXN' } },
  });
  expect(priceNoop.changed).toBe(false);
  p = await execute({
    kind: 'SET_PRODUCT_ACTIVE',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: p.version!,
    payload: { active: false },
  });
  expect(p.entities[0]).toMatchObject({
    active: false,
    available: true,
    categoryId: c.entityId,
    taxProfileId: profileId,
  });
  validateCatalogBaseline(db);
});
it('blocks duplicate and reserved SKUs and rolls back claims with the mutation/receipt/audit', async () => {
  const p = await create({ sku: 'first' });
  await expect(create({ sku: ' FIRST ' })).rejects.toMatchObject({ code: 'SKU_CONFLICT' });
  db.prepare("INSERT INTO catalog_sku_claims VALUES('RESERVED',NULL,'CONFLICT')").run();
  await expect(create({ sku: 'reserved' })).rejects.toMatchObject({ code: 'SKU_AMBIGUOUS' });
  db.exec(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON catalog_command_receipts BEGIN SELECT RAISE(ABORT,'injected'); END",
  );
  await expect(
    execute({
      kind: 'UPDATE_PRODUCT_DETAILS',
      commandId: id(),
      entityId: p.entityId!,
      expectedVersion: 1,
      payload: { name: 'Change', description: '', sku: 'second', barcode: null, displayOrder: 0 },
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  expect(db.prepare('SELECT name,sku,version FROM products').get()).toEqual({
    name: 'Product',
    sku: 'FIRST',
    version: 1,
  });
  expect(generation()).toEqual({ generation: 1 });
  expect(db.prepare('SELECT sku_key FROM catalog_sku_claims ORDER BY sku_key').all()).toEqual([
    { sku_key: 'FIRST' },
    { sku_key: 'RESERVED' },
  ]);
  expect(db.prepare('SELECT count(*) n FROM audit_log').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT count(*) n FROM catalog_command_receipts').get()).toEqual({ n: 1 });
});
it('category protection, active-product precondition and atomic multi-row reorder', async () => {
  const a = await category(),
    b = await category();
  await create({ category: { id: a.entityId!, version: 1 } });
  await expect(
    execute({
      kind: 'SET_CATEGORY_ACTIVE',
      commandId: id(),
      entityId: a.entityId!,
      expectedVersion: 1,
      payload: { active: false },
    }),
  ).rejects.toMatchObject({ code: 'CATEGORY_HAS_ACTIVE_PRODUCTS' });
  const before = generation();
  await expect(
    execute({
      kind: 'REORDER_CATEGORIES',
      commandId: id(),
      payload: {
        categories: [
          { id: a.entityId!, expectedVersion: 1, displayOrder: 3 },
          { id: b.entityId!, expectedVersion: 2, displayOrder: 4 },
        ],
      },
    }),
  ).rejects.toMatchObject({ code: 'CATALOG_VERSION_CONFLICT' });
  expect(generation()).toEqual(before);
  const r = await execute({
    kind: 'REORDER_CATEGORIES',
    commandId: id(),
    payload: {
      categories: [
        { id: a.entityId!, expectedVersion: 1, displayOrder: 3 },
        { id: b.entityId!, expectedVersion: 1, displayOrder: 4 },
      ],
    },
  });
  expect(r.catalogGeneration).toBe(4);
  expect(r.entities.map((x) => x.version)).toEqual([2, 2]);
  const reorderEvents = db.prepare('SELECT event_type,payload FROM event_log WHERE command_id=?').all(r.commandId) as {event_type:string;payload:string}[];
  expect(reorderEvents).toHaveLength(1);
  expect(reorderEvents[0]!.event_type).toBe('CATALOG_CATEGORY_REORDERED');
  expect(JSON.parse(reorderEvents[0]!.payload)).toMatchObject({catalogGeneration:4,entities:[
    {entityType:'CATEGORY',state:{id:a.entityId,displayOrder:3,version:2}},
    {entityType:'CATEGORY',state:{id:b.entityId,displayOrder:4,version:2}},
  ]});
  const system = db.prepare("SELECT id FROM categories WHERE system_key='UNCATEGORIZED'").get() as {
    id: string;
  };
  await expect(
    execute({
      kind: 'SET_CATEGORY_ACTIVE',
      commandId: id(),
      entityId: system.id,
      expectedVersion: 1,
      payload: { active: false },
    }),
  ).rejects.toMatchObject({ code: 'CATEGORY_SYSTEM_PROTECTED' });
  expect(
    (
      await execute({
        kind: 'UPDATE_CATEGORY',
        commandId: id(),
        entityId: system.id,
        expectedVersion: 1,
        payload: { name: 'Other' },
      })
    ).changed,
  ).toBe(true);
});
it.each([-1, 1.25, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid Money %s at the contract boundary',
  (amount) => {
    expect(
      CatalogCommandSchema.safeParse({
        kind: 'CREATE_PRODUCT',
        commandId: id(),
        expectedVersion: 0,
        payload: { name: 'Money', basePrice: { amount, currency: 'MXN' } },
      }).success,
    ).toBe(false);
  },
);

it('overlapping logical commands cannot both commit the same product version', async () => {
  const p = await create();
  const results = await Promise.allSettled([mutate(p, false), mutate(p, false)]);
  expect(results.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(generation()).toEqual({ generation: 2 });
});
it('normalizes a details no-op and leaves inactive categories unavailable for assignment', async () => {
  const p = await create({ sku: 'ABC' }),
    c = await category();
  const noChange = await execute({
    kind: 'UPDATE_PRODUCT_DETAILS',
    commandId: id(),
    entityId: p.entityId!,
    expectedVersion: 1,
    payload: { name: ' Product ', description: '', sku: ' abc ', barcode: null, displayOrder: 0 },
  });
  expect(noChange.changed).toBe(false);
  await execute({
    kind: 'SET_CATEGORY_ACTIVE',
    commandId: id(),
    entityId: c.entityId!,
    expectedVersion: 1,
    payload: { active: false },
  });
  await expect(create({ category: { id: c.entityId!, version: 2 } })).rejects.toMatchObject({
    code: 'CATEGORY_INACTIVE',
  });
});
it('missing/inactive tax, invalid SKU and wrong currency cannot mutate', async () => {
  await expect(create({ taxProfile: { id: id(), version: 1 } })).rejects.toMatchObject({
    code: 'TAX_PROFILE_REQUIRED',
  });
  await expect(create({ sku: 'bad\u0001value' })).rejects.toMatchObject({ code: 'SKU_INVALID' });
  await expect(create({ basePrice: { amount: 100, currency: 'USD' } })).rejects.toMatchObject({
    code: 'CATALOG_CURRENCY_MISMATCH',
  });
  db.prepare('UPDATE tax_profiles SET active=0 WHERE id=?').run(profileId);
  await expect(create()).rejects.toMatchObject({ code: 'TAX_PROFILE_INACTIVE' });
  expect(generation()).toEqual({ generation: 0 });
});
it('a mid-reorder storage failure rolls back every category and generation', async () => {
  const a = await category(),
    b = await category();
  db.exec(
    `CREATE TRIGGER reject_second BEFORE UPDATE ON categories WHEN OLD.id='${b.entityId}' BEGIN SELECT RAISE(ABORT,'injected'); END`,
  );
  await expect(
    execute({
      kind: 'REORDER_CATEGORIES',
      commandId: id(),
      payload: {
        categories: [
          { id: a.entityId!, expectedVersion: 1, displayOrder: 5 },
          { id: b.entityId!, expectedVersion: 1, displayOrder: 6 },
        ],
      },
    }),
  ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  expect(
    db.prepare('SELECT version,display_order FROM categories WHERE id=?').get(a.entityId),
  ).toEqual({ version: 1, display_order: 0 });
  expect(generation()).toEqual({ generation: 2 });
});
it('audit failure rolls back a newly claimed SKU, product and receipt', async () => {
  db.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'injected'); END",
  );
  await expect(create({ sku: 'new' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  for (const table of ['products', 'catalog_sku_claims', 'catalog_command_receipts'])
    expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(generation()).toEqual({ generation: 0 });
});
it('moving legacy duplicate SKUs never elects a winner or releases the ambiguous reservation', async () => {
  const a = await create({ sku: 'ABC' }),
    b = await create({ sku: 'XYZ' });
  db.prepare("UPDATE products SET sku='ABC',sku_key='ABC' WHERE id=?").run(b.entityId);
  db.exec(
    "DELETE FROM catalog_sku_claims WHERE sku_key='XYZ'; UPDATE catalog_sku_claims SET state='CONFLICT',product_id=NULL WHERE sku_key='ABC'",
  );
  for (const p of [a, b])
    await execute({
      kind: 'UPDATE_PRODUCT_DETAILS',
      commandId: id(),
      entityId: p.entityId!,
      expectedVersion: 1,
      payload: { name: 'Product', description: '', sku: null, barcode: null, displayOrder: 0 },
    });
  expect(db.prepare('SELECT * FROM catalog_sku_claims').all()).toEqual([
    { sku_key: 'ABC', product_id: null, state: 'CONFLICT' },
  ]);
  validateCatalogBaseline(db);
  await expect(create({ sku: 'ABC' })).rejects.toMatchObject({ code: 'SKU_AMBIGUOUS' });
});
