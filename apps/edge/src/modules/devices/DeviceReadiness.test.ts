import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { DeviceService } from './DeviceService.js';
import { BackupManager } from '../backup/BackupManager.js';
import {
  MemoryRecoverySecurityStore,
  ensureRecoveryKey,
  updateRecoverySecurityFloor,
} from '../backup/RecoverySecurityStore.js';

describe('production recovery readiness', () => {
  it.each([
    'ready',
    'running',
    'no-external-or-key',
    'no-external',
    'no-key',
    'stale-local',
    'stale-external',
    'worker-degraded',
    'recovery-required',
    'recovery-in-progress',
    'no-backups',
    'different-destination',
  ])('aggregates %s without blocking ordinary offline operation', async (scenario) => {
    const now = new Date('2026-09-02T00:00:00Z'),
      store = new MemoryRecoverySecurityStore();
    await store.mutate((f) =>
      updateRecoverySecurityFloor(ensureRecoveryKey(f).floor, {
        offDeviceDirectory: scenario.startsWith('no-external')
          ? null
          : scenario === 'different-destination'
            ? 'changed-external'
            : 'external',
        recoveryKeyExportedAt: ['no-key', 'no-external-or-key'].includes(scenario)
          ? null
          : now.toISOString(),
        recoveryState:
          scenario === 'recovery-required'
            ? 'RECOVERY_REQUIRED'
            : scenario === 'recovery-in-progress'
              ? 'RECOVERY_IN_PROGRESS'
              : 'NORMAL',
      }),
    );
    const record = (destinationType: string, stale: boolean) => ({
      backupId: destinationType,
      status: 'VERIFIED',
      trigger: 'MANUAL',
      destinationType,
      artifactPath: resolve(
        destinationType === 'LOCAL' ? 'local' : 'external',
        destinationType + '.cvbackup',
      ),
      createdAt: now,
      completedAt: now,
      verifiedAt: new Date(now.getTime() - (stale ? 5 * 3600_000 : 1000)),
      sizeBytes: 100,
      failureCode: null,
    });
    const records =
      scenario === 'no-backups'
        ? []
        : [
            record('LOCAL', scenario === 'stale-local'),
            ...(scenario.startsWith('no-external')
              ? []
              : [record('OFF_DEVICE', scenario === 'stale-external')]),
          ];
    const manager = new BackupManager(
      {
        list: () => records,
        runtime: () => ({
          workerStatus:
            scenario === 'worker-degraded'
              ? 'DEGRADED'
              : scenario === 'running'
                ? 'RUNNING'
                : 'IDLE',
        }),
      } as any,
      {} as any,
      {} as any,
      store,
      { tenantId: 't', locationId: 'l', edgeId: 'e' },
      'local',
      { info() {}, warn() {} },
    );
    const status = await manager.status(now);
    const service = new DeviceService(
      {
        readinessSnapshot: () => ({
          productCount: 1,
          activeUsers: 1,
          roleCount: 5,
          devicePermissionAssignments: 8,
          cashRegisters: 1,
          stations: 1,
          printTargets: 1,
          activeDevices: 1,
          installation: { bootstrapStatus: 'COMPLETED' },
          sync: { lastSuccessfulSyncAt: now },
        }),
      } as any,
      {
        effectiveCapabilities: () => ({
          mode: 'ACTIVE',
          cloudReachable: true,
          reasonCode: 'OK',
          capabilities: [],
        }),
      } as any,
      { tenantId: 't', locationId: 'l', edgeId: 'e' },
      {},
      undefined,
      undefined,
      { status: async () => status } as any,
    );
    const readiness = await service.readiness(),
      ready = ['ready', 'running'].includes(scenario);
    expect(readiness.productionReadiness).toBe(ready ? 'READY' : 'NOT_READY');
    expect(status.recoveryPreparedness === 'READY').toBe(ready);
    expect(readiness.components.find((c) => c.key === 'BACKUP')?.state === 'READY').toBe(ready);
    expect(readiness.operationalReadiness).toBe('READY');
    if (scenario === 'no-external-or-key')
      expect(readiness.components.find((c) => c.key === 'BACKUP')?.code).toBe(
        'BACKUP_PROTECTION_INCOMPLETE',
      );
    if (scenario === 'recovery-required') expect(readiness.technicalHealth).toBe('NOT_READY');
  });
});
