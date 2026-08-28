import type { LocationOperationalRecord } from '@comanview/database';

export type CloudLocationEdgeStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export function evaluateEdgeStatus(
  record: LocationOperationalRecord,
  now: Date,
  heartbeatStaleThresholdMs: number,
): CloudLocationEdgeStatus {
  if (!record.lastSeenAt || now.getTime() - record.lastSeenAt.getTime() > heartbeatStaleThresholdMs) {
    return 'OFFLINE';
  }
  if (
    record.heartbeatStatus === 'DEGRADED' ||
    record.activeDeadLetterCount > 0 ||
    record.stalledEventCount > 0 ||
    record.incompleteSaleCount > 0 ||
    record.checkpointDegraded
  ) {
    return 'DEGRADED';
  }
  return 'ONLINE';
}
