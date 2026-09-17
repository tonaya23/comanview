import { getUserGuidance } from '@comanview/ui';
import type { KdsPreparationStatus, KdsRealtimeMessage } from '@comanview/contracts';
import { EdgeClientError } from '@comanview/client-sdk';

export type TimerTone = 'NORMAL' | 'WARNING' | 'LATE';

function preparationEndAt(
  sentAt: string,
  status: KdsPreparationStatus,
  readyAt: string | null,
  now: number,
): number {
  return status === 'READY' ? Date.parse(readyAt ?? sentAt) : now;
}

export function elapsedMinutes(
  sentAt: string,
  status: KdsPreparationStatus,
  readyAt: string | null,
  now: number,
): number {
  return Math.max(
    0,
    Math.floor((preparationEndAt(sentAt, status, readyAt, now) - Date.parse(sentAt)) / 60_000),
  );
}

export function formatElapsed(
  sentAt: string,
  status: KdsPreparationStatus,
  readyAt: string | null,
  now: number,
): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((preparationEndAt(sentAt, status, readyAt, now) - Date.parse(sentAt)) / 1_000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function timerTone(
  sentAt: string,
  status: KdsPreparationStatus,
  readyAt: string | null,
  now: number,
  warningMinutes = 5,
  lateMinutes = 10,
): TimerTone {
  const elapsed = elapsedMinutes(sentAt, status, readyAt, now);
  if (elapsed >= lateMinutes) return 'LATE';
  if (elapsed >= warningMinutes) return 'WARNING';
  return 'NORMAL';
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(10_000, 1_000 * 2 ** Math.min(attempt, 4));
}

export function shouldRefreshForMessage(message: KdsRealtimeMessage, stationId: string): boolean {
  return message.stationIds.includes(stationId);
}

export function getKdsErrorMessage(problem: unknown): string {
  const guidance = getUserGuidance(problem instanceof EdgeClientError ? problem : undefined, {
    action: null,
  });
  return guidance.title + '. ' + guidance.explanation;
}
