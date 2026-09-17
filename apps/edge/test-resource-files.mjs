// Measured >5s under global load; <2s individually. Keep whole security protocols intact.
// Full migrations + encrypted snapshots + durable Floor/fsync/locks, with scrypt in Personnel.
// Do not add every SQLite test: require measured sensitivity and document the evidence.
export const resourceTestFiles = [
  'src/modules/backup/RecoveryLifecycle.test.ts',
  'src/modules/personnel/PersonnelSecurityOperation.test.ts',
];
