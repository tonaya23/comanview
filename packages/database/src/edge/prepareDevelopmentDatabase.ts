import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPaths = [
  fileURLToPath(new URL('../../../../migrations/edge/0000_initial.sql', import.meta.url)),
  fileURLToPath(new URL('../../../../migrations/edge/0001_payments_cash.sql', import.meta.url)),
];
const defaultDatabasePath = fileURLToPath(
  new URL('../../../../apps/edge/edge-dev.db', import.meta.url),
);
const databasePath = process.env['COMANVIEW_EDGE_DB_PATH'] ?? defaultDatabasePath;

const sqlite = new Database(databasePath);

try {
  sqlite.pragma('foreign_keys = ON');
  for (const migrationPath of migrationPaths) {
    sqlite.exec(readFileSync(migrationPath, 'utf8'));
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
  });

  seed();
  console.log(`Development Edge database ready at ${databasePath}`);
} finally {
  sqlite.close();
}
