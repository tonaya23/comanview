import type { KdsRealtimeMessage } from '@comanview/contracts';

interface RealtimeSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

const OPEN = 1;

export class RealtimeHub {
  private readonly sockets = new Set<RealtimeSocket>();

  subscribe(socket: RealtimeSocket): void {
    this.sockets.add(socket);
    const remove = () => this.sockets.delete(socket);
    socket.on('close', remove);
    socket.on('error', remove);
  }

  publish(message: KdsRealtimeMessage): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.sockets) {
      if (socket.readyState !== OPEN) {
        this.sockets.delete(socket);
        continue;
      }
      try {
        socket.send(serialized);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
