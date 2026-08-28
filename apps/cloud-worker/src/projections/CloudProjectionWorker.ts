import { setTimeout as delay } from 'node:timers/promises';
import type { CloudProjectionRepository, ClaimedCloudEvent } from '@comanview/database';
import type { CloudWorkerConfig } from '@comanview/config';
import { toProjectionAction } from './eventPayloads.js';

interface ProjectionLogger {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
}

export class CloudProjectionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: CloudProjectionRepository,
    private readonly config: CloudWorkerConfig,
    private readonly workerId: string,
    private readonly logger: ProjectionLogger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const events = await this.repository.claimEvents({
        projectionVersion: this.config.projectionVersion,
        workerId: this.workerId,
        limit: this.config.batchSize,
        leaseDurationMs: this.config.leaseDurationMs,
        now,
      });
      for (const event of events) await this.processEvent(event, now);
      return events.length;
    } finally {
      this.running = false;
    }
  }

  async drain(): Promise<number> {
    let processed = 0;
    while (true) {
      const count = await this.runOnce();
      processed += count;
      if ((await this.repository.countUnprocessed(this.config.projectionVersion)) === 0) {
        return processed;
      }
      if (count === 0) await delay(Math.min(this.config.pollIntervalMs, 1_000));
    }
  }

  private tick(): void {
    void this.runOnce().catch((error: unknown) => {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown worker error.' },
        'Cloud projection polling failed',
      );
    });
  }

  private async processEvent(event: ClaimedCloudEvent, now: Date): Promise<void> {
    try {
      const action = toProjectionAction(event);
      if (!action) {
        await this.repository.completeEvent({
          event,
          workerId: this.workerId,
          projectionVersion: this.config.projectionVersion,
          action: { type: 'NOOP' },
          outcome: 'SKIPPED_UNHANDLED',
          now,
        });
        this.logger.warn(
          { eventId: event.eventId, eventType: event.eventType },
          'Cloud projection skipped an unknown event type',
        );
        return;
      }
      await this.repository.completeEvent({
        event,
        workerId: this.workerId,
        projectionVersion: this.config.projectionVersion,
        action,
        now,
      });
      this.logger.info(
        { eventId: event.eventId, eventType: event.eventType },
        'Cloud projection event processed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown projection error.';
      const outcome = await this.repository.failEvent({
        event,
        workerId: this.workerId,
        projectionVersion: this.config.projectionVersion,
        error: message,
        maxAttempts: this.config.maxAttempts,
        retryDelayMs: calculateProjectionRetryDelay(event.processingAttemptCount),
        now,
      });
      const details = { eventId: event.eventId, eventType: event.eventType, outcome };
      if (outcome === 'DEAD_LETTER')
        this.logger.error(details, 'Cloud projection event moved to dead letter');
      else this.logger.warn(details, 'Cloud projection event scheduled for retry');
    }
  }
}

export function calculateProjectionRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 60_000);
}
