import { createEdgeDatabase, EdgeDatabaseHandle, EdgeDatabase } from '@comanview/database';

let dbHandle: EdgeDatabaseHandle | null = null;

export function initDatabase(dbPath: string): EdgeDatabase {
  if (!dbHandle) {
    dbHandle = createEdgeDatabase(dbPath);
  }
  return dbHandle.db;
}

export function getDatabase(): EdgeDatabase {
  if (!dbHandle) {
    throw new Error('Database not initialized');
  }
  return dbHandle.db;
}

export function getRawDatabase(): EdgeDatabaseHandle['sqlite'] {
  if (!dbHandle) throw new Error('Database not initialized');
  return dbHandle.sqlite;
}

export function closeDatabase(): void {
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
}
