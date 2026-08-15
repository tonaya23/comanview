import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
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

/**
 * CatalogRepository persists and retrieves Catalog aggregates to/from Edge SQLite.
 *
 * Products are restored with their full modifier group and price override structure,
 * sufficient to call product.createSnapshot() and produce correct OrderItem snapshots.
 */
export class CatalogRepository {
  constructor(private readonly db: DB) {}

  /**
   * Upsert a Product and all of its related catalog data within a single transaction.
   * Clears existing modifier group assignments and price overrides before reinserting.
   */
  saveProduct(product: Product): void {
    this.db.transaction((txDb) => {
      const db = txDb as unknown as DB;
      const taxProfile = product.taxProfile;

      // 1. Upsert category stub if present (category detail management is a separate concern)
      if (product.categoryId) {
        db.insert(schema.categories)
          .values({ id: product.categoryId.toString(), name: 'Category', active: true })
          .onConflictDoNothing()
          .run();
      }

      // 2. Upsert tax profile
      db.insert(schema.taxProfiles)
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
      db.insert(schema.products)
        .values({
          id: product.id.toString(),
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

      for (let i = 0; i < product.modifierGroups.length; i++) {
        const pmg = product.modifierGroups[i]!;
        const group = pmg.modifierGroup;

        db.insert(schema.productModifierGroups)
          .values({
            productId: product.id.toString(),
            modifierGroupId: group.id.toString(),
            displayOrder: i,
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

    // Load tax profile
    const tRow = this.db
      .select()
      .from(schema.taxProfiles)
      .where(eq(schema.taxProfiles.id, pRow.taxProfileId))
      .get();

    if (!tRow) throw new Error(`TaxProfile ${pRow.taxProfileId} missing for Product ${id}`);

    const taxProfile = new TaxProfile({
      id: EntityId.fromString(tRow.id),
      name: tRow.name,
      rateBasisPoints: tRow.rateBasisPoints,
      calculationMode: tRow.calculationMode as TaxCalculationMode,
      active: Boolean(tRow.active),
    });

    // Load modifier groups for this product (ordered by display_order)
    const pmgRows = this.db
      .select()
      .from(schema.productModifierGroups)
      .where(eq(schema.productModifierGroups.productId, id.toString()))
      .all();

    // Load ALL price overrides for this product once
    const overrideRows = this.db
      .select()
      .from(schema.modifierPriceOverrides)
      .where(eq(schema.modifierPriceOverrides.productId, id.toString()))
      .all();

    const overrideMap = new Map<string, Money>();
    for (const ov of overrideRows) {
      overrideMap.set(ov.modifierOptionId, Money.fromMinorUnits(ov.priceDeltaAmount, ov.priceDeltaCurrency));
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
        .all();

      const options: ModifierOption[] = optionRows.map((o) => new ModifierOption({
        id: EntityId.fromString(o.id),
        name: o.name,
        defaultPriceDelta: Money.fromMinorUnits(o.priceDeltaAmount, o.priceDeltaCurrency),
        active: Boolean(o.active),
        available: Boolean(o.available),
        displayOrder: o.displayOrder,
      }));

      const group = new ModifierGroup({
        id: EntityId.fromString(groupRow.id),
        name: groupRow.name,
        minSelections: groupRow.minSelections,
        maxSelections: groupRow.maxSelections,
        active: Boolean(groupRow.active),
        options,
      });

      modifierGroups.push(new ProductModifierGroup({
        modifierGroup: group,
        priceDeltaOverrides: overrideMap,
      }));
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
