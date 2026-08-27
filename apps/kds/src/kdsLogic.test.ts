import { describe, expect, it } from 'vitest';
import { EdgeClientError } from '@comanview/client-sdk';
import {
  formatElapsed,
  getKdsErrorMessage,
  reconnectDelayMs,
  shouldRefreshForMessage,
  timerTone,
} from './kdsLogic.js';

describe('KDS presentation behavior', () => {
  it('formats elapsed time and applies visual-only thresholds', () => {
    const sentAt = '2026-08-26T12:00:00.000Z';
    expect(formatElapsed(sentAt, 'PREPARING', null, Date.parse('2026-08-26T12:06:09.000Z'))).toBe(
      '06:09',
    );
    expect(timerTone(sentAt, 'PREPARING', null, Date.parse('2026-08-26T12:06:00.000Z'))).toBe(
      'WARNING',
    );
    expect(timerTone(sentAt, 'PREPARING', null, Date.parse('2026-08-26T12:11:00.000Z'))).toBe(
      'LATE',
    );
  });

  it('freezes READY elapsed and severity at readyAt', () => {
    const sentAt = '2026-08-26T12:00:00.000Z';
    const readyAt = '2026-08-26T12:04:08.000Z';
    const muchLater = Date.parse('2026-08-26T13:00:00.000Z');

    expect(formatElapsed(sentAt, 'READY', readyAt, muchLater)).toBe('04:08');
    expect(timerTone(sentAt, 'READY', readyAt, muchLater)).toBe('NORMAL');
  });

  it('refreshes only when realtime affects the selected station', () => {
    const message = {
      type: 'KDS_TICKETS_CHANGED' as const,
      locationId: '01991a00-0000-7000-8000-000000000302',
      orderId: '01991a00-0000-7000-8000-000000000901',
      stationIds: ['station-a'],
      reason: 'ROUND_SENT' as const,
      occurredAt: new Date().toISOString(),
    };
    expect(shouldRefreshForMessage(message, 'station-a')).toBe(true);
    expect(shouldRefreshForMessage(message, 'station-b')).toBe(false);
  });

  it('backs off reconnects and reports local Edge loss explicitly', () => {
    expect(reconnectDelayMs(0)).toBe(1_000);
    expect(reconnectDelayMs(20)).toBe(10_000);
    expect(getKdsErrorMessage(new EdgeClientError('offline', 'EDGE_UNREACHABLE', null))).toBe(
      'CONEXIÓN LOCAL PERDIDA',
    );
  });
});
