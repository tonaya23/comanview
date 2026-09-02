import {
  cleanupRecoveryAcceptanceLab,
  createRecoveryAcceptanceCheckpoint,
  inspectRecoveryAcceptanceLab,
  inspectRecoveryScenarioLab,
  inspectLatestRecoveryArtifact,
  prepareRecoveryAcceptanceLab,
  restoreRecoveryAcceptanceCheckpoint,
  simulateCorruptRuntimeDatabase,
  simulateMissingRuntimeDatabase,
  tamperLatestRecoveryArtifact,
} from './recoveryAcceptanceLab.js';

const options = parseOptions(process.argv.slice(2));
const action = required(options, 'action');
const acceptanceRoot = required(options, 'acceptance-root');
const labRoot = required(options, 'lab-root');

try {
  if (action === 'prepare') {
    const report = await prepareRecoveryAcceptanceLab({
      environment: required(options, 'environment'),
      settingsPath: required(options, 'settings'),
      acceptanceRoot,
      labRoot,
    });
    printPreflight(report);
  } else if (action === 'status') {
    printPreflight(await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot));
  } else if (action === 'recovery-status') {
    const report = await inspectRecoveryScenarioLab(acceptanceRoot, labRoot);
    console.log(`LAB_ROOT = ${report.labRoot}`);
    console.log(`RUNTIME_DB = ${report.runtimeDb}`);
    console.log(`RUNTIME_DB_HEALTH = ${report.runtimeDbHealth}`);
    console.log(`EDGE_SECRET_PRESENT = ${report.edgeSecretPresent}`);
    console.log(`SECURITY_FLOOR_PRESENT = ${report.securityFloorPresent}`);
    console.log(`RECOVERY_LAB_READY = ${report.recoveryLabReady}`);
  } else if (action === 'checkpoint') {
    await createRecoveryAcceptanceCheckpoint(acceptanceRoot, labRoot);
    console.log('CHECKPOINT_READY = true');
  } else if (action === 'restore-checkpoint') {
    await restoreRecoveryAcceptanceCheckpoint(acceptanceRoot, labRoot);
    printPreflight(await inspectRecoveryAcceptanceLab(acceptanceRoot, labRoot));
  } else if (action === 'simulate-missing') {
    console.log(`EVIDENCE_PATH = ${await simulateMissingRuntimeDatabase(acceptanceRoot, labRoot)}`);
    console.log('MISSING_DB_SIMULATED = true');
  } else if (action === 'simulate-corrupt') {
    console.log(`EVIDENCE_PATH = ${await simulateCorruptRuntimeDatabase(acceptanceRoot, labRoot)}`);
    console.log('CORRUPT_DB_SIMULATED = true');
  } else if (action === 'tamper-latest') {
    const result = await tamperLatestRecoveryArtifact(acceptanceRoot, labRoot);
    console.log(`BACKUP_ID = ${result.backupId}`);
    console.log(`TAMPERED_ARTIFACT_PATH = ${result.artifactPath}`);
    console.log('ARTIFACT_TAMPERED = true');
  } else if (action === 'latest-artifact') {
    const result = await inspectLatestRecoveryArtifact(acceptanceRoot, labRoot);
    console.log(`BACKUP_ID = ${result.backupId}`);
    console.log(`ARTIFACT_PATH = ${result.artifactPath}`);
  } else if (action === 'cleanup') {
    await cleanupRecoveryAcceptanceLab(acceptanceRoot, labRoot);
    console.log('LAB_REMOVED = true');
  } else {
    throw new Error('RECOVERY_LAB_ACTION_INVALID');
  }
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RECOVERY_LAB_FAILED';
  console.error(`LAB_READY = false`);
  console.error(`ERROR_CODE = ${code}`);
  process.exitCode = 1;
}

function parseOptions(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]!;
    if (current === '--') continue;
    if (!current.startsWith('--') || !args[index + 1]) throw new Error('RECOVERY_LAB_ARGUMENTS_INVALID');
    result.set(current.slice(2), args[index + 1]!);
    index += 1;
  }
  return result;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error('RECOVERY_LAB_ARGUMENTS_INVALID');
  return value;
}

function printPreflight(report: Awaited<ReturnType<typeof inspectRecoveryAcceptanceLab>>): void {
  console.log(`LAB_ROOT = ${report.labRoot}`);
  console.log(`SOURCE_DB = ${report.sourceDb}`);
  console.log(`RUNTIME_DB = ${report.runtimeDb}`);
  console.log(`SOURCE_DB_EXISTS = ${report.sourceDbExists}`);
  console.log(`RUNTIME_DB_EXISTS = ${report.runtimeDbExists}`);
  console.log(`SAME_PATH = ${report.samePath}`);
  console.log(`SQLITE_INTEGRITY = ${report.sqliteIntegrity}`);
  console.log(`EDGE_SECRET_PRESENT = ${report.edgeSecretPresent}`);
  console.log(`LAB_READY = ${report.labReady}`);
}
