/**
 * @comanview/database
 *
 * Drizzle schema definitions for Edge (SQLite WAL) and Cloud (PostgreSQL).
 * Migrations live in /migrations/edge and /migrations/cloud at repo root.
 */

export * from './edge/db.js';
export * from './edge/recoveryUpgradeSchema.js';
export * from './edge/administrationUpgradeSchema.js';
export * from './edge/catalogUpgradeSchema.js';
export { CatalogProductVersionConflict } from './edge/repositories/ProductAssignmentTransaction.js';
export { readCatalogState,projectedCatalogEntity,appendCatalogMutation,ensureCatalogBaseline } from './edge/catalogPropagation.js';
export * from './edge/repositories/CatalogRepository.js';
export * from './edge/repositories/OrderRepository.js';
export * from './edge/repositories/CashRepository.js';
export * from './edge/repositories/PrintJobRepository.js';
export * from './edge/repositories/KdsRepository.js';
export * from './edge/prepareDevelopmentDatabase.js';
export * from './edge/repositories/AuthRepository.js';
export * from './edge/repositories/AuditRepository.js';
export * from './edge/repositories/TableRepository.js';
export * from './edge/repositories/SyncOutboxRepository.js';
export * from './edge/repositories/EdgeControlRepository.js';
export * from './edge/repositories/DeviceRepository.js';
export * from './edge/repositories/BackupRepository.js';
export * from './cloud/index.js';
export { TaxAdministrationRepository } from './edge/repositories/TaxAdministrationRepository.js';
export * from './edge/repositories/RestaurantAdministrationRepository.js';
export * from './cloud/repositories/CloudPersonnelRecoveryRepository.js';
