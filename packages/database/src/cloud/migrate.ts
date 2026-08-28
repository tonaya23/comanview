import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

export async function migrateCloudDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const migrationsDirectory = fileURLToPath(
    new URL('../../../../migrations/cloud/', import.meta.url),
  );
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloud_schema_migrations (
        migration_name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const files = readdirSync(migrationsDirectory)
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    for (const file of files) {
      const migrationSql = readFileSync(resolve(migrationsDirectory, file), 'utf8');
      const checksum = createHash('sha256').update(migrationSql).digest('hex');
      const existing = await pool.query<{ checksum: string }>(
        'SELECT checksum FROM cloud_schema_migrations WHERE migration_name = $1',
        [file],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied Cloud migration ${file} has changed.`);
        }
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query(
          'INSERT INTO cloud_schema_migrations (migration_name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  await migrateCloudDatabase(databaseUrl);
}
