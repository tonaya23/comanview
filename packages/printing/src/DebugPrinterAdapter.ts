import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderDebugTicket } from './renderer.js';
import {
  PrinterAdapterError,
  type PrintJob,
  type PrinterAdapter,
  type PrintTarget,
} from './types.js';

export interface DebugPrinterAdapterOptions {
  outputDirectory: string;
  failingTargetIds?: ReadonlySet<string>;
}

export class DebugPrinterAdapter implements PrinterAdapter {
  constructor(private readonly options: DebugPrinterAdapterOptions) {}

  async print(job: PrintJob, target: PrintTarget) {
    if (this.options.failingTargetIds?.has(target.targetId)) {
      throw new PrinterAdapterError(
        `Debug target ${target.name} is configured to fail.`,
        'NOT_STARTED',
      );
    }
    await mkdir(this.options.outputDirectory, { recursive: true });
    const safeTarget = target.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
    const path = join(this.options.outputDirectory, `${job.printJobId}-${safeTarget}.txt`);
    await writeFile(path, renderDebugTicket(job), { encoding: 'utf8', flag: 'wx' });
    return { outcome: 'DELIVERED' as const, detail: path };
  }
}
