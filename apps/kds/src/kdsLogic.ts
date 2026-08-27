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

export function getKdsErrorMessage(error: unknown): string {
  if (error instanceof EdgeClientError) {
    if (error.code === 'KDS_INVALID_TRANSITION') {
      return 'El ticket cambió en otra pantalla. Se actualizará desde Edge.';
    }
    if (error.code === 'KDS_TICKET_NOT_FOUND') return 'El ticket ya no está disponible.';
    if (error.code === 'EDGE_UNREACHABLE') return 'CONEXIÓN LOCAL PERDIDA';
    return error.message;
  }
  return error instanceof Error ? error.message : 'No fue posible confirmar la operación.';
}
