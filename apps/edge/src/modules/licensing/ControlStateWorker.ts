import type { EdgeLicensingConfig } from '@comanview/config';
import type { EdgeLicenseManager } from './EdgeLicenseManager.js';

export class ControlStateWorker {
  private pullTimer: NodeJS.Timeout | null = null;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  constructor(private readonly manager: EdgeLicenseManager, private readonly config: EdgeLicensingConfig) {}
  start(): void {
    if (!this.manager.enabled() || this.pullTimer) return;
    void this.pull();
    this.schedulePull(this.config.pullIntervalMs);
    this.checkpointTimer = setInterval(() => this.manager.checkpoint(), this.config.checkpointIntervalMs);
    this.checkpointTimer.unref();
  }
  stop(): void {
    if (this.pullTimer) clearTimeout(this.pullTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    this.pullTimer = null; this.checkpointTimer = null;
  }
  private schedulePull(delay: number): void {
    this.pullTimer = setTimeout(async () => { await this.pull();
      const delayNext = this.failures === 0 ? this.config.pullIntervalMs
        : Math.min(this.config.pullIntervalMs * 2 ** this.failures, this.config.maxBackoffMs);
      this.schedulePull(delayNext);
    }, delay);
    this.pullTimer.unref();
  }
  private async pull(): Promise<void> {
    await this.manager.pullOnce();
    this.failures = this.manager.effectiveCapabilities().cloudReachable ? 0 : this.failures+1;
  }
}
