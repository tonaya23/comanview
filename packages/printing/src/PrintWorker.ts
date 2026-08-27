import { PrinterAdapterError, type PrintQueue, type PrinterAdapter } from './types.js';

export interface PrintWorkerOptions {
  pollIntervalMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

export class PrintWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly queue: PrintQueue,
    private readonly adapter: PrinterAdapter,
    options: PrintWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  start(): void {
    if (this.timer) return;
    this.queue.recoverInterruptedJobs();
    this.timer = setInterval(() => void this.processNext(), this.pollIntervalMs);
    this.timer.unref?.();
    void this.processNext();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processNext(now = new Date()): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const claimed = this.queue.claimNext(now);
      if (!claimed) return false;
      const { job, target } = claimed;
      if (!target) {
        this.queue.markFailed(job.printJobId, 'No active print target is configured.', null);
        return true;
      }
      try {
        const result = await this.adapter.print(job, target);
        if (result.outcome === 'UNKNOWN') {
          this.queue.markUnknown(
            job.printJobId,
            result.detail ?? 'Transmission result is uncertain.',
          );
        } else {
          this.queue.markDelivered(job.printJobId, result.detail);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PrinterAdapterError && error.transmission === 'UNKNOWN') {
          this.queue.markUnknown(job.printJobId, message);
        } else {
          const nextAttemptAt =
            job.attempts >= this.maxAttempts
              ? null
              : new Date(now.getTime() + this.retryDelayMs * job.attempts);
          this.queue.markFailed(job.printJobId, message, nextAttemptAt);
        }
      }
      return true;
    } finally {
      this.running = false;
    }
  }
}
