import { describe, expect, it, vi } from 'vitest';
import type { CloudProvisioningConfig } from '@comanview/config';
import type { CloudControlPlaneRepository, EdgeReplacementRecord } from '@comanview/database';
import { CloudControlPlaneService } from './CloudControlPlaneService.js';

const now = new Date('2026-08-29T07:00:00.000Z');
const replacement: EdgeReplacementRecord = {
  replacementId: '01991a00-2000-7000-8000-000000000001',
  tenantId: '01991a00-2000-7000-8000-000000000002',
  locationId: '01991a00-2000-7000-8000-000000000003',
  oldEdgeId: '01991a00-2000-7000-8000-000000000004', newEdgeId: null,
  status: 'CANCELLED', reason: 'Lost one-time code', initiatedAt: now,
  completedAt: null, cancelledAt: now,
  provisioningCode: {
    provisioningCodeId: '01991a00-2000-7000-8000-000000000005',
    tenantId: '01991a00-2000-7000-8000-000000000002',
    locationId: '01991a00-2000-7000-8000-000000000003', status: 'REVOKED',
    createdAt: now, expiresAt: new Date(now.getTime() + 1_800_000),
  },
};

describe('CloudControlPlaneService replacement cancellation', () => {
  it('returns the audited result on an idempotent retry without cancelling twice', async () => {
    const persisted = JSON.parse(JSON.stringify(replacement)) as Record<string, unknown>;
    const repository = {
      findIdempotentResult: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(persisted),
      cancelReplacement: vi.fn().mockResolvedValue(replacement),
    } as unknown as CloudControlPlaneRepository;
    const service = new CloudControlPlaneService(repository, {} as CloudProvisioningConfig, () => now);
    const input = { commandId: '01991a00-2000-7000-8000-000000000006', reason: 'Lost one-time code' };
    const actor = {
      userId: '01991a00-2000-7000-8000-000000000007',
      sessionId: '01991a00-2000-7000-8000-000000000008',
    };

    await expect(service.cancelReplacement(replacement.replacementId, input, actor)).resolves.toEqual(replacement);
    await expect(service.cancelReplacement(replacement.replacementId, input, actor)).resolves.toEqual(replacement);
    expect(repository.cancelReplacement).toHaveBeenCalledTimes(1);
  });
});
