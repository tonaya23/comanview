import { createConnection, type Socket } from 'node:net';
import { renderEscPosTicket } from './escPosRenderer.js';
import {
  PrinterAdapterError,
  type PrintJob,
  type PrinterAdapter,
  type PrintTarget,
} from './types.js';

export interface TcpPrinterAdapterOptions {
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
}

interface TcpTargetConfiguration {
  host: string;
  port: number;
}

function readConfiguration(target: PrintTarget): TcpTargetConfiguration {
  const host = target.configuration['host'];
  const port = target.configuration['port'];
  if (typeof host !== 'string' || host.length === 0) {
    throw new PrinterAdapterError(`TCP target ${target.name} requires a host.`, 'NOT_STARTED');
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PrinterAdapterError(
      `TCP target ${target.name} requires a valid port.`,
      'NOT_STARTED',
    );
  }
  return { host, port };
}

export class TcpPrinterAdapter implements PrinterAdapter {
  private readonly connectTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(options: TcpPrinterAdapterOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2_000;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 2_000;
  }

  async print(job: PrintJob, target: PrintTarget) {
    const { host, port } = readConfiguration(target);
    const payload = renderEscPosTicket(job);

    await new Promise<void>((resolve, reject) => {
      let socket: Socket;
      let connected = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      const fail = (message: string) =>
        finish(new PrinterAdapterError(message, connected ? 'UNKNOWN' : 'NOT_STARTED'));

      socket = createConnection({ host, port });
      timeout = setTimeout(
        () => fail(`TCP printer ${host}:${port} timed out while connecting.`),
        this.connectTimeoutMs,
      );
      socket.setNoDelay(true);
      socket.once('error', (error) => fail(`TCP printer ${host}:${port}: ${error.message}`));
      socket.once('connect', () => {
        connected = true;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(
          () => fail(`TCP printer ${host}:${port} timed out while sending.`),
          this.writeTimeoutMs,
        );
        socket.end(payload, () => finish());
      });
    });

    return { outcome: 'DELIVERED' as const, detail: `${host}:${port}` };
  }
}
