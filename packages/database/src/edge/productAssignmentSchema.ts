import type Database from 'better-sqlite3';
import { inspectCatalogSchema } from './catalogUpgradeSchema.js';
import { inspectModifierQuantitySchema } from './modifierQuantityUpgradeSchema.js';
import { inspectModifierVersionSchema } from './modifierVersionUpgradeSchema.js';

export const REQUIRED_PRODUCT_ASSIGNMENT_SCHEMA = 16;
/** Evidence from the actual connection, inside the assignment transaction.
 * Unknown future schemas fail closed even though the feature minimum is monotonic. */
export function productAssignmentSchema(sqlite: Database.Database): number | null {
  if (!sqlite.inTransaction) return null;
  try {
    const version = sqlite.pragma('user_version', { simple: true });
    if (version === 16) return inspectCatalogSchema(sqlite);
    if (version === 17) return inspectModifierQuantitySchema(sqlite);
    if (version === 18) return inspectModifierVersionSchema(sqlite);
  } catch { /* Partial or tampered schema is not ready. */ }
  return null;
}
