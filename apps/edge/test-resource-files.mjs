// Measured >5s under global load; <2s individually. Keep whole security protocols intact.
// Full migrations + encrypted snapshots + durable Floor/fsync/locks, with scrypt in Personnel.
// Do not add every SQLite test: require measured sensitivity and document the evidence.
export const resourceTestFiles = [
  'src/modules/backup/RecoveryLifecycle.test.ts',
  'src/modules/personnel/PersonnelSecurityOperation.test.ts',
  // B1 productive upgrade/HTTP security fixtures use full migrations and encrypted snapshots.
  // Keep them out of the concurrent normal group; small in-memory command tests stay there.
  'src/modules/catalog/application/ProductionCatalogUpgrade.test.ts',
  'src/modules/catalog/application/CatalogCommandHttp.test.ts',
  // Cross-cutting native SQLite/PostgreSQL fixture: same serial resource gate, opt-in PG URL.
  'src/modules/catalog/application/CatalogPipeline.postgres.test.ts',
];
