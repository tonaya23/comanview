import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { EntityId } from '@comanview/domain';
import {
  normalizeCatalogSku,
  insertAuditEntry,
  readCatalogState,
  appendCatalogMutation,
  projectedCatalogEntity,
} from '@comanview/database';
import type { CatalogChanged } from '@comanview/contracts';
import {
  CatalogCommandSchema,
  CatalogCommandResultSchema,
  type CatalogCommand,
  type CatalogCommandResult,
  type ErrorCode,
} from '@comanview/contracts';
import type { Permission } from '@comanview/auth';
import type { AuthService } from '../../auth/application/AuthService.js';
import type { AuthenticatedActor } from '../../../app/authContext.js';
import { AppError } from '../../../app/errorHandler.js';

type Binding = { tenantId: string; locationId: string; edgeId: string };
type Row = { id: string; version: number; [key: string]: string | number | null };
function fail(code: ErrorCode, status = 409): never {
  throw new AppError(code, status, 'No se modificó el catálogo.');
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

/** The Floor read lease encloses a synchronous IMMEDIATE SQLite transaction.
 * Fresh authorization, mutation, audit and durable receipt share that boundary.
 * This service never edits Order snapshots or calls legacy saveProduct().
 */
export class CatalogCommandService {
  constructor(
    private db: Database.Database,
    private binding: Binding,
    private auth: Pick<AuthService, 'withCurrentAuthorization'>,
    private publish?: (message: CatalogChanged) => void,
  ) {}

  state() {
    return readCatalogState(this.db);
  }

  execute(input: CatalogCommand, actor: AuthenticatedActor): Promise<CatalogCommandResult> {
    const command = CatalogCommandSchema.parse(input);
    let committed = false;
    return this.auth
      .withCurrentAuthorization(actor, (revalidate, floor) => {
        try {
          return this.db
            .transaction(() => {
              const current = revalidate();
              this.permission(current, 'CATALOG_MANAGE');
              const installation = this.db
                .prepare(
                  "SELECT recovery_epoch epoch FROM edge_installations WHERE singleton_key='PRIMARY' AND edge_id=? AND tenant_id=? AND location_id=?",
                )
                .get(this.binding.edgeId, this.binding.tenantId, this.binding.locationId) as
                { epoch: number } | undefined;
              if (
                !installation ||
                current.tenantId !== this.binding.tenantId ||
                current.locationId !== this.binding.locationId
              )
                fail('ADMINISTRATION_BINDING_MISMATCH', 403);
              if (
                !floor ||
                floor.minimumSchemaVersion !== 16 ||
                floor.recoveryState !== 'NORMAL' ||
                floor.recoveryEpoch !== installation.epoch ||
                floor.binding?.edgeId !== this.binding.edgeId ||
                floor.catalogUpgradeJournal ||
                this.db.pragma('user_version', { simple: true }) !== 16
              )
                fail('RECOVERY_REQUIRED', 503);
              const identity = {
                userId: current.userId,
                deviceId: current.deviceId,
                sessionId: current.sessionId,
              };
              const digest = createHash('sha256')
                .update(
                  canonical({
                    command,
                    binding: this.binding,
                    identity,
                    epoch: installation.epoch,
                  }),
                )
                .digest('hex');
              const receipt = this.db
                .prepare(
                  'SELECT request_digest digest,response_json response,recovery_epoch epoch FROM catalog_command_receipts WHERE command_id=?',
                )
                .get(command.commandId) as
                { digest: string; response: string; epoch: number } | undefined;
              // An old result is evidence, not authority, including specialized permissions.
              this.specializedPermission(command, current);
              if (receipt) {
                if (receipt.digest !== digest || receipt.epoch !== installation.epoch)
                  fail('COMMAND_ID_CONFLICT');
                return CatalogCommandResultSchema.parse(JSON.parse(receipt.response));
              }
              for (const table of ['processed_commands', 'administration_command_receipts'])
                if (
                  this.db
                    .prepare(`SELECT command_id FROM ${table} WHERE command_id=?`)
                    .get(command.commandId)
                )
                  fail('COMMAND_ID_CONFLICT');
              const before: Row[] = [],
                ids: string[] = [];
              const category =
                !command.kind.includes('PRODUCT') &&
                (command.kind.includes('CATEGORY') || command.kind === 'REORDER_CATEGORIES');
              let changed = false;
              if (command.kind === 'CREATE_PRODUCT') {
                const p = command.payload,
                  id = EntityId.generate().toString(),
                  config = this.config();
                this.money(p.basePrice, config);
                const selected = p.category
                  ? this.referenceCategory(p.category)
                  : (this.db
                      .prepare("SELECT * FROM categories WHERE system_key='UNCATEGORIZED'")
                      .get() as Row | undefined);
                if (!selected) fail('CATEGORY_NOT_FOUND', 404);
                const profile = this.tax(
                  p.taxProfile?.id ?? config.default_tax_profile_id,
                  p.taxProfile?.version,
                );
                if (p.station) this.station(p.station);
                const sku = this.sku(p.sku);
                this.claim(id, null, sku, true);
                this.db
                  .prepare(
                    `INSERT INTO products(id,name,description,product_type,category_id,sku,sku_key,barcode,base_price_amount,base_price_currency,
            tax_profile_id,tax_profile_revision,station_id,display_order,active,available,version,updated_at,updated_by)
            VALUES(?,?,?,'STANDARD',?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
                  )
                  .run(
                    id,
                    p.name,
                    p.description,
                    selected.id,
                    sku,
                    sku,
                    p.barcode,
                    p.basePrice.amount,
                    p.basePrice.currency,
                    profile.id,
                    profile.version,
                    p.station?.id ?? null,
                    p.displayOrder,
                    Number(p.active),
                    Number(p.available),
                    Date.now(),
                    current.userId,
                  );
                if (sku)
                  this.db
                    .prepare(
                      "INSERT INTO catalog_sku_claims(sku_key,product_id,state) VALUES(?,?,'CLAIMED')",
                    )
                    .run(sku, id);
                ids.push(id);
                changed = true;
              } else if (command.kind === 'CREATE_CATEGORY') {
                const id = EntityId.generate().toString();
                this.db
                  .prepare(
                    'INSERT INTO categories(id,name,display_order,active,version,updated_at,updated_by) VALUES(?,?,?,1,1,?,?)',
                  )
                  .run(
                    id,
                    command.payload.name,
                    command.payload.displayOrder,
                    Date.now(),
                    current.userId,
                  );
                ids.push(id);
                changed = true;
              } else if (command.kind === 'REORDER_CATEGORIES') {
                if (
                  new Set(command.payload.categories.map((x) => x.id)).size !==
                  command.payload.categories.length
                )
                  fail('CATALOG_REFERENCE_CHANGED');
                for (const entry of command.payload.categories) {
                  const row = this.load('categories', entry.id);
                  this.version(row, entry.expectedVersion, 'CATEGORY');
                  before.push(row);
                  ids.push(row.id);
                }
                for (const entry of command.payload.categories) {
                  const row = before.find((x) => x.id === entry.id)!;
                  changed =
                    this.update(
                      'categories',
                      row,
                      { display_order: entry.displayOrder },
                      current,
                    ) || changed;
                }
              } else {
                const table = category ? 'categories' : 'products',
                  row = this.load(table, command.entityId);
                this.version(row, command.expectedVersion, category ? 'CATEGORY' : 'PRODUCT');
                before.push(row);
                ids.push(row.id);
                let values: Record<string, string | number | null>;
                switch (command.kind) {
                  case 'UPDATE_CATEGORY':
                    values = { name: command.payload.name };
                    break; // label only; system identity is immutable
                  case 'SET_CATEGORY_ACTIVE':
                    if (!command.payload.active) {
                      if (row['system_key']) fail('CATEGORY_SYSTEM_PROTECTED');
                      if (
                        this.db
                          .prepare(
                            'SELECT id FROM products WHERE category_id=? AND active=1 LIMIT 1',
                          )
                          .get(row.id)
                      )
                        fail('CATEGORY_HAS_ACTIVE_PRODUCTS');
                    }
                    values = { active: Number(command.payload.active) };
                    break;
                  case 'UPDATE_PRODUCT_DETAILS': {
                    const p = command.payload,
                      sku = this.sku(p.sku),
                      old = row['sku_key'] as string | null;
                    this.claim(row.id, old, sku);
                    values = {
                      name: p.name,
                      description: p.description,
                      sku: old === sku ? (row['sku'] ?? null) : sku,
                      sku_key: sku,
                      barcode: p.barcode,
                      display_order: p.displayOrder,
                    };
                    break;
                  }
                  case 'SET_PRODUCT_ACTIVE':
                    if (command.payload.active) {
                      this.referenceCategory({ id: String(row['category_id']) });
                      this.tax(String(row['tax_profile_id']), Number(row['tax_profile_revision']));
                      if (row['station_id']) this.station({ id: String(row['station_id']) });
                      this.money(
                        {
                          amount: Number(row['base_price_amount']),
                          currency: String(row['base_price_currency']),
                        },
                        this.config(),
                      );
                    }
                    values = { active: Number(command.payload.active) };
                    break;
                  case 'SET_PRODUCT_AVAILABILITY':
                    values = { available: Number(command.payload.available) };
                    break;
                  case 'ASSIGN_PRODUCT_CATEGORY':
                    this.referenceCategory(command.payload.category);
                    values = { category_id: command.payload.category.id };
                    break;
                  case 'UPDATE_PRODUCT_PRICE':
                    this.money(command.payload.basePrice, this.config());
                    values = {
                      base_price_amount: command.payload.basePrice.amount,
                      base_price_currency: command.payload.basePrice.currency,
                    };
                    break;
                }
                changed = this.update(table, row, values, current);
              }
              const eventType = (
                {
                  CREATE_PRODUCT: 'CATALOG_PRODUCT_CREATED',
                  UPDATE_PRODUCT_DETAILS: 'CATALOG_PRODUCT_UPDATED',
                  SET_PRODUCT_ACTIVE: 'CATALOG_PRODUCT_STATUS_CHANGED',
                  SET_PRODUCT_AVAILABILITY: 'CATALOG_PRODUCT_STATUS_CHANGED',
                  ASSIGN_PRODUCT_CATEGORY: 'CATALOG_PRODUCT_UPDATED',
                  UPDATE_PRODUCT_PRICE: 'CATALOG_PRODUCT_PRICE_CHANGED',
                  CREATE_CATEGORY: 'CATALOG_CATEGORY_CREATED',
                  UPDATE_CATEGORY: 'CATALOG_CATEGORY_UPDATED',
                  SET_CATEGORY_ACTIVE: 'CATALOG_CATEGORY_STATUS_CHANGED',
                  REORDER_CATEGORIES: 'CATALOG_CATEGORY_REORDERED',
                } as const
              )[command.kind];
              if (changed)
                this.db
                  .prepare(
                    "UPDATE catalog_state SET generation=generation+1 WHERE singleton_key='PRIMARY'",
                  )
                  .run();
              const generation = this.db
                .prepare("SELECT generation FROM catalog_state WHERE singleton_key='PRIMARY'")
                .get() as { generation: number } | undefined;
              if (!generation) fail('RECOVERY_REQUIRED', 503);
              const after = ids.map((id) => this.load(category ? 'categories' : 'products', id));
              const result = CatalogCommandResultSchema.parse({
                commandId: command.commandId,
                entityType:
                  command.kind === 'REORDER_CATEGORIES'
                    ? 'CATEGORIES'
                    : category
                      ? 'CATEGORY'
                      : 'PRODUCT',
                entityId: ids.length === 1 ? ids[0] : null,
                version: ids.length === 1 ? after[0]!.version : null,
                catalogGeneration: generation.generation,
                recoveryEpoch: installation.epoch,
                changed,
                entities: after.map((row) => this.publicRow(row, category)),
              });
              const eventId = changed
                ? appendCatalogMutation(
                    this.db,
                    this.binding,
                    eventType,
                    command.commandId,
                    ids.map((id) =>
                      projectedCatalogEntity(this.db, category ? 'CATEGORY' : 'PRODUCT', id),
                    ),
                  )
                : null;
              if (changed)
                insertAuditEntry(drizzle(this.db), {
                  auditId: EntityId.generate().toString(),
                  occurredAt: new Date(),
                  ...this.binding,
                  ...{
                    deviceId: current.deviceId,
                    sessionId: current.sessionId,
                    actorUserId: current.userId,
                    actorRole: current.roles[0] ?? null,
                  },
                  authorizedByUserId: null,
                  authorizedByRole: null,
                  action: 'CATALOG_CHANGED',
                  entityType: category ? 'CATEGORY' : 'PRODUCT',
                  entityId: ids[0]!,
                  outcome: 'SUCCESS',
                  reason: 'reason' in command ? command.reason : command.kind,
                  commandId: command.commandId,
                  before: { entities: before },
                  after: { command, result },
                  amountAffected: null,
                  currency: null,
                  eventId,
                });
              this.db
                .prepare(
                  'INSERT INTO catalog_command_receipts(command_id,tenant_id,location_id,edge_id,recovery_epoch,request_digest,response_json,completed_at) VALUES(?,?,?,?,?,?,?,?)',
                )
                .run(
                  command.commandId,
                  this.binding.tenantId,
                  this.binding.locationId,
                  this.binding.edgeId,
                  installation.epoch,
                  digest,
                  JSON.stringify(result),
                  Date.now(),
                );
              committed = changed;
              return result;
            })
            .immediate();
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError('INTERNAL_ERROR', 500, 'No se pudo confirmar el comando de catálogo.');
        }
      })
      .then((result) => {
        if (committed) {
          try {
            this.publish?.({
              type: 'CATALOG_CHANGED',
              locationId: this.binding.locationId,
              capabilityVersion: 1,
              recoveryEpoch: result.recoveryEpoch,
              catalogGeneration: result.catalogGeneration,
              affectedTypes: [result.entityType === 'PRODUCT' ? 'PRODUCT' : 'CATEGORY'],
              affectedIds: result.entities.length <= 100 ? result.entities.map((e) => e.id) : [],
              fullInvalidation: result.entities.length > 100,
            });
          } catch {
            /* Durable mutation remains acknowledged; generation reads recover notification loss. */
          }
        }
        return result;
      });
  }
  private permission(actor: AuthenticatedActor, permission: Permission) {
    if (!actor.permissions.includes(permission)) fail('PERMISSION_DENIED', 403);
  }
  private specializedPermission(command: CatalogCommand, actor: AuthenticatedActor) {
    if (command.kind !== 'CREATE_PRODUCT') return;
    if (command.payload.station) this.permission(actor, 'STATION_MANAGE');
    if (
      command.payload.taxProfile &&
      command.payload.taxProfile.id !== this.config().default_tax_profile_id
    )
      this.permission(actor, 'TAX_PROFILE_MANAGE');
  }
  private config() {
    const row = this.db
      .prepare(
        'SELECT currency,default_tax_profile_id FROM operational_configuration WHERE tenant_id=? AND location_id=?',
      )
      .get(this.binding.tenantId, this.binding.locationId) as
      { currency: string | null; default_tax_profile_id: string | null } | undefined;
    if (!row) fail('ADMINISTRATION_CONFIGURATION_REQUIRED');
    return row;
  }
  private money(m: { amount: number; currency: string }, config: { currency: string | null }) {
    if (!config.currency) fail('CURRENCY_REQUIRED');
    if (config.currency !== m.currency) fail('CATALOG_CURRENCY_MISMATCH');
  }
  private load(table: 'products' | 'categories', id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row | undefined;
    if (!row) fail(table === 'products' ? 'PRODUCT_NOT_FOUND' : 'CATEGORY_NOT_FOUND', 404);
    return row;
  }
  private version(row: Row, expected: number, entityType: 'PRODUCT' | 'CATEGORY') {
    if (row.version !== expected)
      throw new AppError(
        'CATALOG_VERSION_CONFLICT',
        409,
        'El registro cambió. Actualiza antes de guardar.',
        { entityType, entityId: row.id, expectedVersion: expected, actualVersion: row.version },
      );
  }
  private referenceCategory(ref: { id: string; version?: number }) {
    const row = this.load('categories', ref.id);
    if (ref.version !== undefined && row.version !== ref.version) fail('CATALOG_REFERENCE_CHANGED');
    if (!row['active']) fail('CATEGORY_INACTIVE');
    return row;
  }
  private station(ref: { id: string; version?: number }) {
    const row = this.db
      .prepare('SELECT * FROM stations WHERE id=? AND tenant_id=? AND location_id=?')
      .get(ref.id, this.binding.tenantId, this.binding.locationId) as Row | undefined;
    if (!row || !row['active']) fail('STATION_REQUIRED');
    if (ref.version !== undefined && row.version !== ref.version) fail('CATALOG_REFERENCE_CHANGED');
  }
  private tax(id: string | null, revision?: number) {
    if (!id) fail('TAX_CONFIGURATION_REQUIRED');
    const row = this.db.prepare('SELECT * FROM tax_profiles WHERE id=?').get(id) as Row | undefined;
    if (!row) fail('TAX_PROFILE_REQUIRED');
    if (!row['active']) fail('TAX_PROFILE_INACTIVE');
    if (revision !== undefined && revision !== row.version) fail('CATALOG_REFERENCE_CHANGED');
    const immutable = this.db
      .prepare(
        'SELECT 1 FROM tax_profile_revisions WHERE tax_profile_id=? AND revision=? AND rate_basis_points=? AND calculation_mode=?',
      )
      .get(id, row.version, row['rate_basis_points'], row['calculation_mode']);
    if (!immutable) fail('TAX_REVISION_INCONSISTENT');
    return row;
  }
  private sku(value: string | null) {
    try {
      return normalizeCatalogSku(value);
    } catch {
      fail('SKU_INVALID');
    }
  }
  private claim(id: string, old: string | null, key: string | null, creating = false) {
    if (old === key) return;
    if (key) {
      const claim = this.db
        .prepare('SELECT product_id,state FROM catalog_sku_claims WHERE sku_key=?')
        .get(key) as { product_id: string | null; state: string } | undefined;
      if (claim) fail(claim.state === 'CONFLICT' ? 'SKU_AMBIGUOUS' : 'SKU_CONFLICT');
    }
    // Ambiguous legacy reservations never select a winner when one member moves.
    if (old)
      this.db
        .prepare(
          "DELETE FROM catalog_sku_claims WHERE sku_key=? AND product_id=? AND state='CLAIMED'",
        )
        .run(old, id);
    if (key && !creating)
      this.db
        .prepare("INSERT INTO catalog_sku_claims(sku_key,product_id,state) VALUES(?,?,'CLAIMED')")
        .run(key, id);
  }
  private update(
    table: 'products' | 'categories',
    row: Row,
    values: Record<string, string | number | null>,
    actor: AuthenticatedActor,
  ) {
    if (Object.entries(values).every(([k, v]) => row[k] === v)) return false;
    const entries = Object.entries(values);
    this.db
      .prepare(
        `UPDATE ${table} SET ${entries.map(([key]) => `${key}=?`).join(',')},version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?`,
      )
      .run(...entries.map(([, v]) => v), Date.now(), actor.userId, row.id, row.version);
    return true;
  }
  private publicRow(row: Row, category: boolean) {
    return category
      ? {
          id: row.id,
          name: row['name'],
          active: Boolean(row['active']),
          displayOrder: row['display_order'],
          version: row.version,
          systemKey: row['system_key'],
        }
      : {
          id: row.id,
          name: row['name'],
          description: row['description'],
          categoryId: row['category_id'],
          sku: row['sku'],
          barcode: row['barcode'],
          basePrice: { amount: row['base_price_amount'], currency: row['base_price_currency'] },
          taxProfileId: row['tax_profile_id'],
          taxProfileRevision: row['tax_profile_revision'],
          stationId: row['station_id'],
          displayOrder: row['display_order'],
          active: Boolean(row['active']),
          available: Boolean(row['available']),
          version: row.version,
        };
  }
}
