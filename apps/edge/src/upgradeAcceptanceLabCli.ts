import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  prepareUpgradeLab,
  inspectUpgradeLab,
  recordUpgradeStart,
  upgradeLabEnvironment,
  upgradeLabPaths,
} from './upgradeAcceptanceLab.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!, process.argv[i + 1] ?? '');
const required = (key: string) => {
  const value = args.get(key);
  if (!value) throw new Error('UPGRADE_LAB_ARGUMENT_REQUIRED');
  return value;
};
try {
  const parent = required('--acceptance-root'),
    root = required('--lab-root'),
    action = required('--action');
  const paths = upgradeLabPaths(parent, root);
  if (action === 'prepare') {
    await portFree();
    const mode = required('--source-store');
    if (mode !== 'development-file' && mode !== 'windows-dpapi')
      throw new Error('UPGRADE_LAB_STORE_INVALID');
    print(
      await prepareUpgradeLab({
        acceptanceRoot: parent,
        labRoot: root,
        settingsPath: required('--settings'),
        publicKeyPath: required('--public-key'),
        kid: required('--kid'),
        sourceStore: mode,
      }),
    );
  } else if (action === 'status') print(await inspectUpgradeLab(parent, root));
  else if (action === 'start') {
    await portFree();
    const env = await upgradeLabEnvironment(parent, root);
    const startId = randomUUID();
    print({
      ISOLATED_RUNTIME: true,
      RUNTIME_DB: paths.db,
      NODE_ENV: env.NODE_ENV,
      SYNC_ENABLED: false,
      CLOUD_URL_CONFIGURED: false,
      EDGE_SECRET_STORE: env.COMANVIEW_EDGE_SECRET_STORE,
      RECOVERY_SECURITY_STORE: env.COMANVIEW_RECOVERY_SECURITY_STORE,
    });
    // Execute the real product entry point, not a helper calling buildApp or the upgrader.
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('./index.ts', import.meta.url)),
      ],
      { cwd: join(paths.root, 'runtime'), env, stdio: 'inherit', windowsHide: true },
    );
    if (!child.pid) throw new Error('UPGRADE_LAB_START_FAILED');
    const done = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    await writeFile(
      join(paths.root, '.running.json'),
      JSON.stringify({ startId, pid: child.pid }),
      { mode: 0o600 },
    );
    let stopping = false;
    const stop = () => {
      stopping = true;
      child.kill('SIGINT');
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try {
      const exitCode = await done;
      process.exitCode = stopping ? 0 : exitCode;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  } else if (action === 'verify-first' || action === 'verify-restart') {
    await inspectUpgradeLab(parent, root);
    const run = JSON.parse(await readFile(join(root, '.running.json'), 'utf8')) as {
      startId: string;
      pid: number;
    };
    if (!Number.isSafeInteger(run.pid) || typeof run.startId !== 'string')
      throw new Error('UPGRADE_LAB_START_EVIDENCE_INVALID');
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction Stop).OwningProcess | Select-Object -Unique',
      ],
      { windowsHide: true },
    );
    if (stdout.trim() !== String(run.pid)) throw new Error('UPGRADE_LAB_WRONG_SERVER');
    const response = await fetch('http://127.0.0.1:3000/health', {
      signal: AbortSignal.timeout(5000),
    });
    const health = (await response.json()) as {
      status?: string;
      database?: { status?: string };
      recoveryState?: string;
    };
    if (
      !response.ok ||
      health.status !== 'UP' ||
      health.database?.status !== 'OK' ||
      (health.recoveryState !== undefined && health.recoveryState !== 'NORMAL')
    )
      throw new Error('UPGRADE_LAB_HEALTH_NOT_NORMAL');
    print({
      ...(await recordUpgradeStart(parent, root, run.startId, action === 'verify-restart')),
      HEALTH: 'UP',
      DATABASE: 'OK',
      PRODUCT_ENTRY_POINT: true,
    });
  } else throw new Error('UPGRADE_LAB_ACTION_INVALID');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(
    `ERROR_CODE = ${/^UPGRADE_LAB_[A-Z_]+$/.test(message) ? message : 'UPGRADE_LAB_FAILED'}`,
  );
  console.error('STOP: preserve the lab and its evidence. No automatic cleanup or retry.');
  process.exitCode = 1;
}
function print(report: object) {
  for (const [key, value] of Object.entries(report)) console.log(`${key} = ${String(value)}`);
}
async function portFree() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('UPGRADE_LAB_PORT_BUSY')));
    server.listen(3000, '0.0.0.0', () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
