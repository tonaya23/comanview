import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { appendCatalogMutation, projectedCatalogEntity } from '../catalogPropagation.js';
import type {
  TaxAdministrationCommand,
  RestaurantAdministrationCommand,
  TaxAdministrationResult,
} from '@comanview/contracts';
import * as schema from '../schema.js';
import { insertAuditEntry, type NewAuditEntry } from './AuditRepository.js';

type DB = BetterSQLite3Database<typeof schema>;
type Assignment = Extract<
  TaxAdministrationCommand | RestaurantAdministrationCommand,
  { kind: 'ASSIGN_PRODUCT_TAX_PROFILE' | 'ASSIGN_PRODUCT_STATION' }
>;
export class CatalogProductVersionConflict extends Error {
  constructor(
    public readonly entityId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super('CATALOG_VERSION_CONFLICT');
  }
}

/** Caller owns BEGIN IMMEDIATE and current authorization. No nested command or commit.
 * Specialized validation, single Product OCC, generation, Audit/Event and receipt are atomic.
 */
export function assignProductReference(
  db: DB,
  command: Assignment,
  binding: { tenantId: string; locationId: string; edgeId: string },
  epoch: number,
  audit: NewAuditEntry,
  digest: string,
  raw: Database.Database,
): TaxAdministrationResult {
  if (db.get<{ user_version: number }>(sql`PRAGMA user_version`)?.user_version !== 16)
    throw new Error('RECOVERY_REQUIRED');
  if (
    db.get(
      sql`SELECT command_id FROM catalog_command_receipts WHERE command_id=${command.commandId}`,
    )
  )
    throw new Error('COMMAND_ID_CONFLICT');
  const product = db.get<{
    version: number;
    taxId: string;
    taxRevision: number | null;
    stationId: string | null;
  }>(
    sql`SELECT version,tax_profile_id taxId,tax_profile_revision taxRevision,station_id stationId FROM products WHERE id=${command.productId}`,
  );
  if (!product) throw new Error('PRODUCT_NOT_FOUND');
  if (product.version !== command.expectedVersion)
    throw new CatalogProductVersionConflict(
      command.productId,
      command.expectedVersion,
      product.version,
    );
  const state = db.get<{ generation: number }>(
    sql`SELECT generation FROM catalog_state WHERE singleton_key='PRIMARY'`,
  );
  if (!state) throw new Error('RECOVERY_REQUIRED');
  let reference: { kind: 'TAX_PROFILE' | 'STATION'; id: string | null; version: number | null },
    changed: boolean;
  if (command.kind === 'ASSIGN_PRODUCT_TAX_PROFILE') {
    const profile = db.get<{
      id: string;
      version: number;
      active: number;
      rate: number;
      mode: string;
    }>(
      sql`SELECT id,version,active,rate_basis_points rate,calculation_mode mode FROM tax_profiles WHERE id=${command.profileId}`,
    );
    if (!profile) throw new Error('TAX_PROFILE_REQUIRED');
    if (!profile.active) throw new Error('TAX_PROFILE_INACTIVE');
    if (command.profileVersion !== undefined && profile.version !== command.profileVersion)
      throw new Error('CATALOG_REFERENCE_CHANGED');
    if (
      !db.get(
        sql`SELECT 1 FROM tax_profile_revisions WHERE tax_profile_id=${profile.id} AND revision=${profile.version} AND rate_basis_points=${profile.rate} AND calculation_mode=${profile.mode}`,
      )
    )
      throw new Error('TAX_REVISION_INCONSISTENT');
    reference = { kind: 'TAX_PROFILE', id: profile.id, version: profile.version };
    changed = product.taxId !== profile.id || product.taxRevision !== profile.version;
    if (changed)
      db.run(
        sql`UPDATE products SET tax_profile_id=${profile.id},tax_profile_revision=${profile.version},version=version+1,updated_at=${audit.occurredAt.getTime()},updated_by=${audit.actorUserId} WHERE id=${command.productId} AND version=${command.expectedVersion}`,
      );
  } else {
    const station = command.stationId
      ? db.get<{ id: string; version: number; active: number }>(
          sql`SELECT id,version,active FROM stations WHERE id=${command.stationId} AND tenant_id=${binding.tenantId} AND location_id=${binding.locationId}`,
        )
      : undefined;
    if (command.stationId && (!station || !station.active)) throw new Error('STATION_REQUIRED');
    if (command.stationVersion !== undefined && station?.version !== command.stationVersion)
      throw new Error('CATALOG_REFERENCE_CHANGED');
    reference = { kind: 'STATION', id: command.stationId, version: station?.version ?? null };
    changed = product.stationId !== command.stationId;
    if (
      changed &&
      product.stationId &&
      db.get(
        sql`SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.station_id=${product.stationId} AND oi.product_id=${command.productId} AND o.status='OPEN' AND oi.send_status='SENT' AND oi.prep_status IN ('PENDING','PREPARING') LIMIT 1`,
      )
    )
      throw new Error('STATION_HAS_PENDING_WORK');
    if (changed)
      db.run(
        sql`UPDATE products SET station_id=${command.stationId},version=version+1,updated_at=${audit.occurredAt.getTime()},updated_by=${audit.actorUserId} WHERE id=${command.productId} AND version=${command.expectedVersion}`,
      );
  }
  const result: TaxAdministrationResult = {
    entityId: command.productId,
    version: product.version + (changed ? 1 : 0),
    catalogGeneration: state.generation + (changed ? 1 : 0),
    changed,
    recoveryEpoch: epoch,
    reference,
  };
  if (!Number.isSafeInteger(result.version) || !Number.isSafeInteger(result.catalogGeneration))
    throw new Error('CATALOG_VERSION_CONFLICT');
  if (changed) {
    db.run(
      sql`UPDATE catalog_state SET generation=${result.catalogGeneration} WHERE singleton_key='PRIMARY'`,
    );
    const eventType =
      command.kind === 'ASSIGN_PRODUCT_TAX_PROFILE'
        ? 'CATALOG_PRODUCT_TAX_ASSIGNED'
        : 'CATALOG_PRODUCT_STATION_ASSIGNED';
    const after = {
      payloadVersion: 1,
      productId: command.productId,
      productVersion: result.version,
      catalogGeneration: result.catalogGeneration,
      reference,
      ...binding,
    };
    const eventId = appendCatalogMutation(raw, binding, eventType, command.commandId, [
      projectedCatalogEntity(raw, 'PRODUCT', command.productId),
    ]);
    insertAuditEntry(db, {
      ...audit,
      entityType: 'PRODUCT',
      entityId: command.productId,
      before: { ...product },
      after,
      eventId,
    });
  }
  db.run(
    sql`INSERT INTO administration_command_receipts(command_id,location_id,command_type,request_digest,response_json,recovery_epoch,completed_at) VALUES(${command.commandId},${binding.locationId},${command.kind},${digest},${JSON.stringify(result)},${epoch},${audit.occurredAt.getTime()})`,
  );
  db.insert(schema.processedCommands)
    .values({ commandId: command.commandId, processedAt: audit.occurredAt })
    .run();
  return result;
}
