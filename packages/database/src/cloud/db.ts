import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type CloudDatabase = NodePgDatabase<typeof schema>;

export interface CloudDatabaseHandle {
  db: CloudDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createCloudDatabase(databaseUrl: string): CloudDatabaseHandle {
  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
