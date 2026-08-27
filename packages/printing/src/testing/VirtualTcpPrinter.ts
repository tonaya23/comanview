import { createServer, type Server, type Socket } from 'node:net';

export type VirtualTcpPrinterBehavior = 'CAPTURE' | 'DISCONNECT' | 'FAIL';

/** Localhost-only ESC/POS receiver for tests and local development. */
export class VirtualTcpPrinter {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly payloads: Uint8Array[] = [];
  private waiters: Array<(payload: Uint8Array) => void> = [];
  private portValue: number | null = null;

  constructor(private behavior: VirtualTcpPrinterBehavior = 'CAPTURE') {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      if (this.behavior === 'DISCONNECT') {
        socket.end();
        return;
      }
      if (this.behavior === 'FAIL') {
        socket.destroy();
        return;
      }
      const chunks: Uint8Array[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        const payload = Buffer.concat(chunks);
        this.payloads.push(payload);
        this.waiters.shift()?.(payload);
        socket.end();
      });
    });
  }

  get port(): number {
    if (this.portValue === null) throw new Error('VirtualTcpPrinter is not listening.');
    return this.portValue;
  }

  get receivedPayloads(): ReadonlyArray<Uint8Array> {
    return this.payloads;
  }

  setBehavior(behavior: VirtualTcpPrinterBehavior): void {
    this.behavior = behavior;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') return reject(new Error('No TCP address.'));
        this.portValue = address.port;
        resolve();
      });
    });
  }

  waitForPayload(timeoutMs = 2_000): Promise<Uint8Array> {
    const existing = this.payloads[0];
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Virtual printer receive timeout.')),
        timeoutMs,
      );
      this.waiters.push((payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    this.portValue = null;
  }
}
