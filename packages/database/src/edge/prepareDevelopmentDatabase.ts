import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const migrationPaths = [
  fileURLToPath(new URL('../../../../migrations/edge/0000_initial.sql', import.meta.url)),
  fileURLToPath(new URL('../../../../migrations/edge/0001_payments_cash.sql', import.meta.url)),
];
const specialInstructionsMigrationPath = fileURLToPath(
  new URL('../../../../migrations/edge/0002_order_item_special_instructions.sql', import.meta.url),
);
const defaultDatabasePath = fileURLToPath(
  new URL('../../../../apps/edge/edge-dev.db', import.meta.url),
);
const databasePath = process.env['COMANVIEW_EDGE_DB_PATH'] ?? defaultDatabasePath;

export function prepareDevelopmentDatabase(targetPath = databasePath): void {
  const sqlite = new Database(targetPath);

  try {
    sqlite.pragma('foreign_keys = ON');
    for (const migrationPath of migrationPaths) {
      sqlite.exec(readFileSync(migrationPath, 'utf8'));
    }
    const hasSpecialInstructions = sqlite
      .prepare("SELECT 1 FROM pragma_table_info('order_items') WHERE name = 'special_instructions'")
      .get();
    if (!hasSpecialInstructions) {
      sqlite.exec(readFileSync(specialInstructionsMigrationPath, 'utf8'));
    }

    const seed = sqlite.transaction(() => {
      const insertCategory = sqlite.prepare(
        'INSERT OR IGNORE INTO categories (id, name, active) VALUES (?, ?, 1)',
      );
      const insertTaxProfile = sqlite.prepare(`
      INSERT OR IGNORE INTO tax_profiles
        (id, name, rate_basis_points, calculation_mode, active, is_default)
      VALUES (?, ?, ?, ?, 1, 1)
    `);
      const insertProduct = sqlite.prepare(`
      INSERT OR IGNORE INTO products
        (id, name, description, product_type, category_id, tax_profile_id,
         base_price_amount, base_price_currency, display_order, active, available)
      VALUES (?, ?, ?, 'STANDARD', ?, ?, ?, 'MXN', ?, 1, 1)
    `);
      const insertModifierGroup = sqlite.prepare(`
      INSERT OR IGNORE INTO modifier_groups
        (id, name, min_selections, max_selections, active)
      VALUES (?, ?, ?, ?, 1)
    `);
      const insertModifierOption = sqlite.prepare(`
      INSERT OR IGNORE INTO modifier_options
        (id, group_id, name, price_delta_amount, price_delta_currency,
         active, available, display_order)
      VALUES (?, ?, ?, ?, 'MXN', 1, 1, ?)
    `);
      const assignModifierGroup = sqlite.prepare(`
      INSERT OR IGNORE INTO product_modifier_groups
        (product_id, modifier_group_id, display_order)
      VALUES (?, ?, ?)
    `);
      const insertPriceOverride = sqlite.prepare(`
      INSERT OR IGNORE INTO modifier_price_overrides
        (product_id, modifier_option_id, price_delta_amount, price_delta_currency)
      VALUES (?, ?, ?, 'MXN')
    `);

      const foodCategoryId = '01991a00-0000-7000-8000-000000000001';
      const drinksCategoryId = '01991a00-0000-7000-8000-000000000002';
      const taxProfileId = '01991a00-0000-7000-8000-000000000010';

      insertCategory.run(foodCategoryId, 'Alimentos');
      insertCategory.run(drinksCategoryId, 'Bebidas');
      insertTaxProfile.run(taxProfileId, 'IVA incluido', 1600, 'TAX_INCLUDED');

      const products = [
        [
          '01991a00-0000-7000-8000-000000000101',
          'Hamburguesa clásica',
          'Carne, queso y vegetales',
          foodCategoryId,
          12900,
          10,
        ],
        [
          '01991a00-0000-7000-8000-000000000102',
          'Tacos al pastor',
          'Orden de cuatro tacos',
          foodCategoryId,
          9800,
          20,
        ],
        [
          '01991a00-0000-7000-8000-000000000103',
          'Papas fritas',
          'Porción para compartir',
          foodCategoryId,
          5900,
          30,
        ],
        [
          '01991a00-0000-7000-8000-000000000201',
          'Limonada',
          'Limonada natural de la casa',
          drinksCategoryId,
          4500,
          10,
        ],
        [
          '01991a00-0000-7000-8000-000000000202',
          'Café americano',
          'Café recién preparado',
          drinksCategoryId,
          3800,
          20,
        ],
        [
          '01991a00-0000-7000-8000-000000000203',
          'Agua mineral',
          'Botella individual',
          drinksCategoryId,
          3200,
          30,
        ],
      ] as const;

      for (const [id, name, description, categoryId, amount, displayOrder] of products) {
        insertProduct.run(id, name, description, categoryId, taxProfileId, amount, displayOrder);
      }

      const hamburgerId = '01991a00-0000-7000-8000-000000000101';
      const donenessGroupId = '01991a00-0000-7000-8000-000000000401';
      const extrasGroupId = '01991a00-0000-7000-8000-000000000402';
      const preparationGroupId = '01991a00-0000-7000-8000-000000000403';

      insertModifierGroup.run(donenessGroupId, 'Término', 1, 1);
      insertModifierGroup.run(extrasGroupId, 'Extras', 0, 2);
      insertModifierGroup.run(preparationGroupId, 'Preparación', 0, 2);

      const options = [
        ['01991a00-0000-7000-8000-000000000411', donenessGroupId, 'Medio', 0, 10],
        ['01991a00-0000-7000-8000-000000000412', donenessGroupId, '3/4', 0, 20],
        ['01991a00-0000-7000-8000-000000000413', donenessGroupId, 'Bien cocido', 0, 30],
        // Queso has a $15 default and a Hamburger-specific $20 override below.
        ['01991a00-0000-7000-8000-000000000421', extrasGroupId, 'Queso', 1500, 10],
        ['01991a00-0000-7000-8000-000000000422', extrasGroupId, 'Tocino', 2500, 20],
        ['01991a00-0000-7000-8000-000000000423', extrasGroupId, 'Aguacate', 2000, 30],
        ['01991a00-0000-7000-8000-000000000431', preparationGroupId, 'Sin cebolla', 0, 10],
        ['01991a00-0000-7000-8000-000000000432', preparationGroupId, 'Sin tomate', 0, 20],
      ] as const;
      for (const option of options) insertModifierOption.run(...option);

      assignModifierGroup.run(hamburgerId, donenessGroupId, 10);
      assignModifierGroup.run(hamburgerId, extrasGroupId, 20);
      assignModifierGroup.run(hamburgerId, preparationGroupId, 30);
      insertPriceOverride.run(hamburgerId, '01991a00-0000-7000-8000-000000000421', 2000);
    });

    seed();
    console.log(`Development Edge database ready at ${targetPath}`);
  } finally {
    sqlite.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) prepareDevelopmentDatabase();
