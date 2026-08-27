import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareDevelopmentDatabase } from '../prepareDevelopmentDatabase.js';

describe('development catalog seed', () => {
  it('refuses to create known development credentials in production', () => {
    const productionPath = join(tmpdir(), `comanview-production-seed-${Date.now()}.db`);
    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(() => prepareDevelopmentDatabase(productionPath)).toThrow(
        'Development database preparation is disabled in production.',
      );
      expect(existsSync(productionPath)).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
    }
  });

  it('is idempotent and keeps one configured Hamburger fixture', () => {
    const databasePath = join(tmpdir(), `comanview-development-seed-${Date.now()}.db`);

    try {
      prepareDevelopmentDatabase(databasePath);
      prepareDevelopmentDatabase(databasePath);

      const sqlite = new Database(databasePath, { readonly: true });
      try {
        const counts = sqlite
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM modifier_groups) AS groups,
              (SELECT COUNT(*) FROM modifier_options) AS options,
              (SELECT COUNT(*) FROM product_modifier_groups) AS assignments,
              (SELECT COUNT(*) FROM modifier_price_overrides) AS overrides`,
          )
          .get() as Record<string, number>;
        expect(counts).toEqual({ groups: 3, options: 8, assignments: 3, overrides: 1 });

        const hamburgerGroups = sqlite
          .prepare(
            `SELECT mg.name, pmg.display_order
             FROM product_modifier_groups pmg
             JOIN modifier_groups mg ON mg.id = pmg.modifier_group_id
             WHERE pmg.product_id = ?
             ORDER BY pmg.display_order`,
          )
          .all('01991a00-0000-7000-8000-000000000101');
        expect(hamburgerGroups).toEqual([
          { name: 'Término', display_order: 10 },
          { name: 'Extras', display_order: 20 },
          { name: 'Preparación', display_order: 30 },
        ]);

        const routing = sqlite
          .prepare(
            `
          SELECT p.name AS product_name, s.name AS station_name
          FROM products p LEFT JOIN stations s ON s.id = p.station_id
          WHERE p.name IN ('Hamburguesa clásica', 'Limonada', 'Agua mineral')
          ORDER BY p.name
        `,
          )
          .all();
        expect(routing).toEqual([
          { product_name: 'Agua mineral', station_name: 'BARRA' },
          { product_name: 'Hamburguesa clásica', station_name: 'COCINA' },
          { product_name: 'Limonada', station_name: 'BARRA' },
        ]);
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM print_targets').get()).toEqual({
          count: 3,
        });
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM roles').get()).toEqual({ count: 5 });
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 5 });
        expect(sqlite.prepare('SELECT COUNT(*) AS count FROM devices').get()).toEqual({ count: 2 });
        const credentials = sqlite.prepare('SELECT pin_hash AS pinHash FROM users').all() as Array<{
          pinHash: string;
        }>;
        expect(credentials.every(({ pinHash }) => pinHash.startsWith('scrypt-v1$'))).toBe(true);
        expect(
          credentials.some(({ pinHash }) => ['1111', '2222', '3333', '4444'].includes(pinHash)),
        ).toBe(false);
      } finally {
        sqlite.close();
      }
    } finally {
      for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
        if (existsSync(path)) unlinkSync(path);
      }
    }
  });
});
