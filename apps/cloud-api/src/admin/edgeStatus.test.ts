import { describe, expect, it } from 'vitest';
import type { LocationOperationalRecord } from '@comanview/database';
import { evaluateEdgeStatus } from './edgeStatus.js';

const now = new Date('2026-08-28T12:00:00.000Z');
function record(overrides: Partial<LocationOperationalRecord> = {}): LocationOperationalRecord {
  return {
    tenantId: '01991a00-0000-7000-8000-000000000101',
    locationId: '01991a00-0000-7000-8000-000000000102',
    edgeId: '01991a00-0000-7000-8000-000000000103',
    heartbeatStatus: 'ONLINE',
    lastSeenAt: new Date(now.getTime() - 30_000),
    reportedAt: now,
    edgeVersion: '1.0.0', schemaVersion: '12', pendingEventCount: 3,
    activeDeadLetterCount: 0, stalledEventCount: 0, incompleteSaleCount: 0,
    checkpointDegraded: false, lastEventReceivedAt: now, lastProjectionProcessedAt: now,
    ...overrides,
  };
}

describe('Cloud Edge status policy', () => {
  it('is ONLINE with a fresh healthy heartbeat even when transient pending events exist', () => {
    expect(evaluateEdgeStatus(record(), now, 90_000)).toBe('ONLINE');
  });
  it('is OFFLINE without heartbeat or beyond the configurable threshold', () => {
    expect(evaluateEdgeStatus(record({ lastSeenAt: null }), now, 90_000)).toBe('OFFLINE');
    expect(evaluateEdgeStatus(record({ lastSeenAt: new Date(now.getTime() - 90_001) }), now, 90_000)).toBe('OFFLINE');
    expect(evaluateEdgeStatus(record({ lastSeenAt: new Date(now.getTime() - 100_000) }), now, 120_000)).toBe('ONLINE');
  });
  it('is DEGRADED only for active current health problems while heartbeat is fresh', () => {
    expect(evaluateEdgeStatus(record({ heartbeatStatus: 'DEGRADED' }), now, 90_000)).toBe('DEGRADED');
    expect(evaluateEdgeStatus(record({ stalledEventCount: 1 }), now, 90_000)).toBe('DEGRADED');
    expect(evaluateEdgeStatus(record({ activeDeadLetterCount: 1 }), now, 90_000)).toBe('DEGRADED');
    expect(evaluateEdgeStatus(record({ incompleteSaleCount: 1 }), now, 90_000)).toBe('DEGRADED');
    expect(evaluateEdgeStatus(record({ checkpointDegraded: true }), now, 90_000)).toBe('DEGRADED');
    expect(evaluateEdgeStatus(record(), now, 90_000)).toBe('ONLINE');
  });
});
