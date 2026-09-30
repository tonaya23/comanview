import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readProductModifierConfigurations } from './productModifierConfiguration.js';
import {
  CatalogStateSchema,
  CatalogProjectedEntitySchema,
  CatalogMutationPayloadSchema,
  canonicalCatalogJson,
  type CatalogProjectedEntity,
  type CatalogBaselinePayload,
} from '@comanview/contracts';
type Binding = { tenantId: string; locationId: string; edgeId: string };
export function readCatalogState(db: Database.Database) {
  const row = db
    .prepare(
      "SELECT recovery_epoch recoveryEpoch,generation catalogGeneration FROM edge_installations,catalog_state WHERE edge_installations.singleton_key='PRIMARY' AND catalog_state.singleton_key='PRIMARY'",
    )
    .get();
  return CatalogStateSchema.parse({ ...(row as object), capabilityVersion: 1 });
}
export function projectedCatalogEntity(
  db: Database.Database,
  type: 'PRODUCT' | 'CATEGORY' | 'MODIFIER_GROUP' | 'MODIFIER_OPTION',
  id: string,
): CatalogProjectedEntity {
  if(type==='MODIFIER_GROUP') {
    const row=db.prepare('SELECT id,name,min_selections minSelections,max_selections maxSelections,active,version FROM modifier_groups WHERE id=?').get(id) as Record<string,unknown>;
    return CatalogProjectedEntitySchema.parse({entityType:type,state:{...row,active:Boolean(row['active'])}});
  }
  if(type==='MODIFIER_OPTION') {
    const row=db.prepare('SELECT id,group_id groupId,name,price_delta_amount amount,price_delta_currency currency,active,available,display_order displayOrder,version FROM modifier_options WHERE id=?').get(id) as Record<string,unknown>;
    const {amount,currency,...fields}=row;
    return CatalogProjectedEntitySchema.parse({entityType:type,state:{...fields,active:Boolean(row['active']),available:Boolean(row['available']),unitPriceDelta:{amount,currency}}});
  }
  if (type === 'CATEGORY') {
    const row = db
      .prepare(
        'SELECT id,name,active,display_order displayOrder,system_key systemKey,version FROM categories WHERE id=?',
      )
      .get(id) as Record<string, unknown>;
    return CatalogProjectedEntitySchema.parse({
      entityType: type,
      state: { ...row, active: Boolean(row['active']) },
    });
  }
  const row = db
    .prepare(
      `SELECT id,name,description,product_type productType,category_id categoryId,sku,barcode,base_price_amount amount,base_price_currency currency,active,available,tax_profile_id taxProfileId,tax_profile_revision taxProfileRevision,station_id stationId,display_order displayOrder,version FROM products WHERE id=?`,
    )
    .get(id) as Record<string, unknown>;
  return CatalogProjectedEntitySchema.parse({
    entityType: type,
    state: {
      ...row,
      active: Boolean(row['active']),
      available: Boolean(row['available']),
      basePrice: { amount: row['amount'], currency: row['currency'] },
      ...(db.pragma('user_version',{simple:true})===18?{modifierAssignments:readProductModifierConfigurations(db).find(p=>p.productId===id)!.assignments}:{}),
    },
  });
}
function append(
  db: Database.Database,
  binding: Binding,
  type: string,
  aggregateId: string,
  version: number,
  payload: unknown,
  commandId: string | null = null,
) {
  const state = readCatalogState(db),
    id = randomUUID();
  db.prepare(
    `INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,version,recovery_epoch,payload,occurred_at,command_id,sync_status) VALUES(?,?,'CATALOG',?,?,?,?,?,?,'PENDING')`,
  ).run(
    id,
    type,
    aggregateId,
    version,
    state.recoveryEpoch,
    JSON.stringify(payload),
    Date.now(),
    commandId,
  );
  return id;
}
/** Invoke within the caller's synchronous IMMEDIATE transaction. */
export function appendCatalogMutation(
  db: Database.Database,
  binding: Binding,
  eventType: string,
  commandId: string,
  entities: CatalogProjectedEntity[],
) {
  const state = readCatalogState(db),
    first = entities[0]!;
  const payload = CatalogMutationPayloadSchema.parse({
    payloadVersion: 1,
    ...binding,
    entityId: first.state.id,
    entityVersion: first.state.version,
    catalogGeneration: state.catalogGeneration,
    commandId,
    entities,
  });
  return append(db, binding, eventType, first.state.id, first.state.version, payload, commandId);
}
/** One durable baseline per binding/epoch. Whole capture and Event Log append commit together.
 * Chunks are consecutive in local_sequence; subsequent mutations are ordered after COMPLETED. */
export function ensureCatalogBaseline(db: Database.Database, binding: Binding): void {
  db.transaction(() => {
    let state = readCatalogState(db);
    const structureVersion=Number(db.pragma('user_version',{simple:true}))>=18?2:1;
    const identity = db
      .prepare(
        "SELECT edge_id,tenant_id,location_id FROM edge_installations WHERE singleton_key='PRIMARY'",
      )
      .get() as { edge_id: string; tenant_id: string; location_id: string };
    if (
      identity.edge_id !== binding.edgeId ||
      identity.tenant_id !== binding.tenantId ||
      identity.location_id !== binding.locationId
    )
      throw new Error('CATALOG_BINDING_MISMATCH');
    if (
      db
        .prepare(
          "SELECT 1 FROM event_log WHERE event_type='CATALOG_BASELINE_COMPLETED' AND recovery_epoch=? AND json_extract(payload,'$.sourceEpoch')=? AND COALESCE(json_extract(payload,'$.catalogStructureVersion'),1)>=? LIMIT 1",
        )
        .get(state.recoveryEpoch, state.recoveryEpoch,structureVersion)
    )
      return;
    // A full extended capture supersedes a legacy baseline at a newer generation.
    // No epoch change and no fake business mutation; all chunks commit atomically.
    if(structureVersion===2&&db.prepare("SELECT 1 FROM event_log WHERE event_type='CATALOG_BASELINE_COMPLETED' AND recovery_epoch=? AND json_extract(payload,'$.sourceEpoch')=? LIMIT 1").get(state.recoveryEpoch,state.recoveryEpoch)) {
      db.prepare("UPDATE catalog_state SET generation=generation+1 WHERE singleton_key='PRIMARY'").run();
      state=readCatalogState(db);
    }
    const entities: CatalogProjectedEntity[] = [];
    for (const [table, type] of [
      ['categories', 'CATEGORY'],
      ['products', 'PRODUCT'],
    ] as const) {
      for (const row of db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[])
        entities.push(projectedCatalogEntity(db, type, row.id));
    }
    if(structureVersion===2)for(const [table,type] of [['modifier_groups','MODIFIER_GROUP'],['modifier_options','MODIFIER_OPTION']] as const)
      for(const row of db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as {id:string}[])
        entities.push(projectedCatalogEntity(db,type,row.id));
    const digest = createHash('sha256').update(canonicalCatalogJson(entities)).digest('hex');
    const baselineId = createHash('sha256')
      .update(canonicalCatalogJson({ ...binding, ...state, digest }))
      .digest('hex');
    // Bound bytes as well as entities so ordinary long descriptions fit Sync batches.
    const chunks: CatalogProjectedEntity[][] = [[]];
    let bytes = 0;
    for (const entity of entities) {
      const size = Buffer.byteLength(JSON.stringify(entity));
      if (size > 128 * 1024) throw new Error('CATALOG_ENTITY_TOO_LARGE');
      if (chunks.at(-1)!.length && (chunks.at(-1)!.length >= 100 || bytes + size > 128 * 1024)) {
        chunks.push([]);
        bytes = 0;
      }
      chunks.at(-1)!.push(entity);
      bytes += size;
    }
    const manifest = {
      payloadVersion: 1 as const,
      ...(structureVersion===2?{catalogStructureVersion:2 as const}:{}),
      ...binding,
      sourceEpoch: state.recoveryEpoch,
      baselineId,
      catalogGeneration: state.catalogGeneration,
      chunkCount: chunks.length,
      entityCount: entities.length,
      digest,
    };
    const write = (payload: CatalogBaselinePayload) =>
      append(db, binding, `CATALOG_BASELINE_${payload.phase}`, binding.edgeId, 1, payload);
    write({ ...manifest, phase: 'STARTED' });
    chunks.forEach((chunk, chunkIndex) =>
      write({ ...manifest, phase: 'CHUNK', chunkIndex, entities: chunk }),
    );
    write({ ...manifest, phase: 'COMPLETED' });
  }).immediate();
}
