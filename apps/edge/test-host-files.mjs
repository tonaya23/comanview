// Keep whole files together: native cases retain their real security protocol
// and the neighbouring regression cases run without host-resource contention.
export const hostTestFiles = [
  'src/__tests__/upgradeAcceptanceLab.test.ts',
  'src/modules/backup/ProductionRecoveryUpgrade.test.ts',
  'src/modules/backup/RecoverySecurityConcurrency.test.ts',
  'src/modules/backup/RecoverySecurityStore.test.ts',
  'src/modules/provisioning/EdgeSecretStore.test.ts',
];
