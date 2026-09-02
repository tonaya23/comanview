import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type EdgeDatabase = BetterSQLite3Database<typeof schema>;

export interface EdgeDatabaseHandle {
  db: EdgeDatabase;
  sqlite: Database.Database;
  close(): void;
}

export function createEdgeDatabase(dbPath: string): EdgeDatabaseHandle {
  const sqlite = new Database(dbPath);

  // Set required pragmas for Edge (PRD §12.4, §12.5)
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
