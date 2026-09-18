import { asc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import * as schema from '../schema.js';
import {
  EntityId,
  Product,
  ProductProps,
  TaxProfile,
  TaxCalculationMode,
  ModifierGroup,
  ModifierOption,
  ProductModifierGroup,
  ProductType,
} from '@comanview/domain';
import { Money } from '@comanview/money';

type DB = BetterSQLite3Database<typeof schema>;
type DBWithClient = DB & { $client: Database.Database };

/**
 * CatalogRepository persists and retrieves Catalog aggregates to/from Edge SQLite.
 *
 * Products are restored with their full modifier group and price override structure,
 * sufficient to call product.createSnapshot() and produce correct OrderItem snapshots.
 */
export class CatalogRepository {
  constructor(private readonly db: DB) {}

  getProductVersion(id:string):number|undefined{
    // Legacy read-only callers have no Product OCC column. Never synthesize an
    // expectedVersion; current/partially migrated schemas must still fail closed.
    if ((this.db.get<{user_version:number}>(sql`PRAGMA user_version`)?.user_version ?? 0) < 15 &&
      !this.db.get(sql`SELECT 1 FROM pragma_table_info('products') WHERE name='version'`) &&
      !this.db.get(sql`SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_state'`)) return undefined;
    const row=this.db.get<{version:number}>(sql`SELECT version FROM products WHERE id=${id}`);
    if(!row)throw new Error('PRODUCT_NOT_FOUND');return row.version;
  }

  private hasFiscalRevisions(): boolean {
    return Boolean(this.db.get(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tax_profile_revisions'`));
  }

  getFiscalPolicyVersion(tenantId: string, locationId: string): 0 | 1 {
    if (!this.hasFiscalRevisions()) return 0;
    const row = this.db.get<{ version: number }>(sql`SELECT fiscal_policy_version AS version FROM operational_configuration
      WHERE tenant_id=${tenantId} AND location_id=${locationId}`);
    if (row?.version !== 1) throw new Error('TAX_CONFIGURATION_REQUIRED');
    return 1;
  }

  getTaxProfile(id: EntityId): TaxProfile | null {
    const row = this.db.select().from(schema.taxProfiles).where(eq(schema.taxProfiles.id, id.toString())).get();
    if (!row) return null;
    let revision: number | undefined;
    if (this.hasFiscalRevisions()) {
      const current = this.db.get<{ revision: number; rate: number; mode: string }>(sql`
        SELECT r.revision,r.rate_basis_points AS rate,r.calculation_mode AS mode
        FROM tax_profile_revisions r JOIN tax_profiles p ON p.id=r.tax_profile_id AND p.version=r.revision
        WHERE p.id=${id.toString()}`);
      if (!current || current.rate !== row.rateBasisPoints || current.mode !== row.calculationMode)
        throw new Error('TAX_REVISION_INCONSISTENT');
      revision = current.revision;
    }
    return new TaxProfile({ id, name: row.name, rateBasisPoints: row.rateBasisPoints,
      calculationMode: row.calculationMode as TaxCalculationMode, active: Boolean(row.active),
      ...(revision === undefined ? {} : { revision }) });
  }

  /**
   * Upsert a Product and all of its related catalog data within a single transaction.
   * Clears existing modifier group assignments and price overrides before reinserting.
  */
  saveProduct(product: Product): void {
    if(this.db.get(sql`SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_state'`))throw new Error('CLIENT_CAPABILITY_REQUIRED');
    const versionedTaxes = this.hasFiscalRevisions();
    const existingFiscal = versionedTaxes
      ? (this.db as DBWithClient).$client.prepare(
          'SELECT tax_profile_revision AS revision FROM products WHERE id=?',
        ).get(product.id.toString()) as { revision: number | null } | undefined
      : undefined;
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;
      const taxProfile = product.taxProfile;
      if (versionedTaxes) {
        const current = this.getTaxProfile(taxProfile.id);
        if (!current) throw new Error('TAX_PROFILE_REQUIRED');
        if (current.revision !== taxProfile.revision || current.rateBasisPoints !== taxProfile.rateBasisPoints ||
          current.calculationMode !== taxProfile.calculationMode || current.active !== taxProfile.active || current.name !== taxProfile.name)
          throw new Error('TAX_PROFILE_REQUIRES_ADMIN_COMMAND');
      }

      // 1. Upsert category stub if present (category detail management is a separate concern)
      if (product.categoryId) {
        db.insert(schema.categories)
          .values({ id: product.categoryId.toString(), name: 'Category', active: true })
          .onConflictDoNothing()
          .run();
      }

      // 2. Upsert tax profile
      if (!versionedTaxes) db.insert(schema.taxProfiles)
        .values({
          id: taxProfile.id.toString(),
          name: taxProfile.name,
          rateBasisPoints: taxProfile.rateBasisPoints,
          calculationMode: taxProfile.calculationMode,
          active: taxProfile.active,
          isDefault: false,
        })
        .onConflictDoUpdate({
          target: schema.taxProfiles.id,
          set: {
            name: taxProfile.name,
            rateBasisPoints: taxProfile.rateBasisPoints,
            calculationMode: taxProfile.calculationMode,
            active: taxProfile.active,
          },
        })
        .run();

      // 3. Upsert modifier groups and their options
      for (const pmg of product.modifierGroups) {
        const group = pmg.modifierGroup;

        db.insert(schema.modifierGroups)
          .values({
            id: group.id.toString(),
            name: group.name,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            active: group.active,
          })
          .onConflictDoUpdate({
            target: schema.modifierGroups.id,
            set: {
              name: group.name,
              minSelections: group.minSelections,
              maxSelections: group.maxSelections,
              active: group.active,
            },
          })
          .run();

        for (const option of group.options) {
          db.insert(schema.modifierOptions)
            .values({
              id: option.id.toString(),
              groupId: group.id.toString(),
              name: option.name,
              priceDeltaAmount: option.defaultPriceDelta.amount,
              priceDeltaCurrency: option.defaultPriceDelta.currency,
              active: option.active,
              available: option.available,
              displayOrder: option.displayOrder,
            })
            .onConflictDoUpdate({
              target: schema.modifierOptions.id,
              set: {
                name: option.name,
                priceDeltaAmount: option.defaultPriceDelta.amount,
                priceDeltaCurrency: option.defaultPriceDelta.currency,
                active: option.active,
                available: option.available,
                displayOrder: option.displayOrder,
              },
            })
            .run();
        }
      }

      // 4. Upsert product
      const productValues = {
        id: product.id.toString(), name: product.name, description: product.description,
        productType: product.productType, categoryId: product.categoryId?.toString() ?? null,
        taxProfileId: taxProfile.id.toString(), basePriceAmount: product.basePrice.amount,
        basePriceCurrency: product.basePrice.currency, stationId: product.stationId?.toString() ?? null,
        sku: product.sku ?? null, barcode: product.barcode ?? null, displayOrder: product.displayOrder,
        active: product.active, available: product.available,
      };
      if (versionedTaxes) {
        const persistedRevision = existingFiscal?.revision ?? taxProfile.revision;
        if (persistedRevision === null) throw new Error('TAX_REVISION_INVALID');
        (this.db as DBWithClient).$client.prepare(`INSERT INTO products
          (id,name,description,product_type,category_id,tax_profile_id,tax_profile_revision,
           base_price_amount,base_price_currency,station_id,sku,barcode,display_order,active,available)
          VALUES(@id,@name,@description,@productType,@categoryId,@taxProfileId,@taxProfileRevision,
           @basePriceAmount,@basePriceCurrency,@stationId,@sku,@barcode,@displayOrder,@active,@available)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
           product_type=excluded.product_type,category_id=excluded.category_id,tax_profile_id=excluded.tax_profile_id,
           tax_profile_revision=excluded.tax_profile_revision,base_price_amount=excluded.base_price_amount,
           base_price_currency=excluded.base_price_currency,station_id=excluded.station_id,sku=excluded.sku,
           barcode=excluded.barcode,display_order=excluded.display_order,active=excluded.active,available=excluded.available`)
          .run({ ...productValues, active: product.active ? 1 : 0, available: product.available ? 1 : 0,
            taxProfileRevision: persistedRevision });
      } else db.insert(schema.products)
        .values({
          ...productValues,
        })
        .onConflictDoUpdate({
          target: schema.products.id,
          set: {
            name: product.name,
            description: product.description,
            productType: product.productType,
            categoryId: product.categoryId?.toString() ?? null,
            taxProfileId: taxProfile.id.toString(),
            basePriceAmount: product.basePrice.amount,
            basePriceCurrency: product.basePrice.currency,
            stationId: product.stationId?.toString() ?? null,
            sku: product.sku ?? null,
            barcode: product.barcode ?? null,
            displayOrder: product.displayOrder,
            active: product.active,
            available: product.available,
          },
        })
        .run();
      // 5. Reset and reinsert product_modifier_groups + overrides
      db.delete(schema.productModifierGroups)
        .where(eq(schema.productModifierGroups.productId, product.id.toString()))
        .run();
      db.delete(schema.modifierPriceOverrides)
        .where(eq(schema.modifierPriceOverrides.productId, product.id.toString()))
        .run();

      for (const pmg of product.modifierGroups) {
        const group = pmg.modifierGroup;

        db.insert(schema.productModifierGroups)
          .values({
            productId: product.id.toString(),
            modifierGroupId: group.id.toString(),
            displayOrder: pmg.displayOrder,
          })
          .run();

        for (const option of group.options) {
          const override = pmg.getPriceForOption(option.id);
          // Only persist overrides where the price differs from the default
          if (override && override.amount !== option.defaultPriceDelta.amount) {
            db.insert(schema.modifierPriceOverrides)
              .values({
                productId: product.id.toString(),
                modifierOptionId: option.id.toString(),
                priceDeltaAmount: override.amount,
                priceDeltaCurrency: override.currency,
              })
              .run();
          }
        }
      }
    });
  }

  getAllProducts(): Product[] {
    const pRows = this.db.select({ id: schema.products.id }).from(schema.products).all();
    const products: Product[] = [];
    for (const p of pRows) {
      const prod = this.getProductById(EntityId.fromString(p.id));
      if (prod) products.push(prod);
    }
    return products;
  }

  getAllCategories(): { id: string; name: string; active: boolean;version?:number;displayOrder?:number;systemKey?:'UNCATEGORIZED'|null }[] {
    if(this.db.get(sql`SELECT 1 FROM pragma_table_info('categories') WHERE name='system_key'`))
      return this.db.all<{id:string;name:string;active:number;version:number;displayOrder:number;systemKey:'UNCATEGORIZED'|null}>(sql`SELECT id,name,active,version,display_order displayOrder,system_key systemKey FROM categories ORDER BY display_order,id`).map(row=>({...row,active:Boolean(row.active)}));
    return this.db
      .select()
      .from(schema.categories)
      .all()
      .map((c) => ({
        id: c.id,
        name: c.name,
        active: Boolean(c.active),
      }));
  }

  /**
   * Retrieve a Product by its domain EntityId.
   * Returns null if not found.
   * Restores the complete Product with TaxProfile, ModifierGroups, ModifierOptions
   * and price overrides — sufficient to produce new OrderItem snapshots.
   */
  getProductById(id: EntityId): Product | null {
    const pRow = this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, id.toString()))
      .get();

    if (!pRow) return null;

    const taxProfile = this.getTaxProfile(EntityId.fromString(pRow.taxProfileId));
    if (!taxProfile) throw new Error('TAX_PROFILE_REQUIRED');

    // Load modifier groups for this product (ordered by display_order)
    const pmgRows = this.db
      .select()
      .from(schema.productModifierGroups)
      .where(eq(schema.productModifierGroups.productId, id.toString()))
      .orderBy(asc(schema.productModifierGroups.displayOrder))
      .all();

    // Load ALL price overrides for this product once
    const overrideRows = this.db
      .select()
      .from(schema.modifierPriceOverrides)
      .where(eq(schema.modifierPriceOverrides.productId, id.toString()))
      .all();

    const overrideMap = new Map<string, Money>();
    for (const ov of overrideRows) {
      overrideMap.set(
        ov.modifierOptionId,
        Money.fromMinorUnits(ov.priceDeltaAmount, ov.priceDeltaCurrency),
      );
    }

    const modifierGroups: ProductModifierGroup[] = [];

    for (const pmgRow of pmgRows) {
      const groupRow = this.db
        .select()
        .from(schema.modifierGroups)
        .where(eq(schema.modifierGroups.id, pmgRow.modifierGroupId))
        .get();
      if (!groupRow) continue;

      const optionRows = this.db
        .select()
        .from(schema.modifierOptions)
        .where(eq(schema.modifierOptions.groupId, pmgRow.modifierGroupId))
        .orderBy(asc(schema.modifierOptions.displayOrder))
        .all();

      const options: ModifierOption[] = optionRows.map(
        (o) =>
          new ModifierOption({
            id: EntityId.fromString(o.id),
            name: o.name,
            defaultPriceDelta: Money.fromMinorUnits(o.priceDeltaAmount, o.priceDeltaCurrency),
            active: Boolean(o.active),
            available: Boolean(o.available),
            displayOrder: o.displayOrder,
          }),
      );

      const group = new ModifierGroup({
        id: EntityId.fromString(groupRow.id),
        name: groupRow.name,
        minSelections: groupRow.minSelections,
        maxSelections: groupRow.maxSelections,
        active: Boolean(groupRow.active),
        options,
      });

      modifierGroups.push(
        new ProductModifierGroup({
          modifierGroup: group,
          displayOrder: pmgRow.displayOrder,
          priceDeltaOverrides: overrideMap,
        }),
      );
    }

    const props: ProductProps = {
      id: EntityId.fromString(pRow.id),
      name: pRow.name,
      description: pRow.description,
      productType: pRow.productType as ProductType,
      categoryId: pRow.categoryId ? EntityId.fromString(pRow.categoryId) : EntityId.generate(),
      taxProfile,
      basePrice: Money.fromMinorUnits(pRow.basePriceAmount, pRow.basePriceCurrency),
      stationId: pRow.stationId ? EntityId.fromString(pRow.stationId) : null,
      sku: pRow.sku ?? null,
      barcode: pRow.barcode ?? null,
      displayOrder: pRow.displayOrder,
      active: Boolean(pRow.active),
      available: Boolean(pRow.available),
      modifierGroups,
    };

    return new Product(props);
  }
}
