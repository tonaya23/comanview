import type { OperationalRealtimeMessage } from '@comanview/contracts';

interface RealtimeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

interface RealtimeSubscriber {
  socket: RealtimeSocket;
  locationId: string;
  isAuthorized: () => boolean;
}

const OPEN = 1;

export class RealtimeHub {
  private readonly subscribers = new Set<RealtimeSubscriber>();

  subscribe(
    socket: RealtimeSocket,
    locationId: string,
    isAuthorized: () => boolean = () => true,
  ): void {
    const subscriber = { socket, locationId, isAuthorized };
    this.subscribers.add(subscriber);
    const remove = () => this.subscribers.delete(subscriber);
    socket.on('close', remove);
    socket.on('error', remove);
  }

  publish(message: OperationalRealtimeMessage): void {
    const serialized = JSON.stringify(message);
    for (const subscriber of this.subscribers) {
      const { socket, locationId, isAuthorized } = subscriber;
      if (!isAuthorized()) {
        this.subscribers.delete(subscriber);
        socket.close(1008, 'Local session is no longer authorized.');
        continue;
      }
      if (socket.readyState !== OPEN) {
        this.subscribers.delete(subscriber);
        continue;
      }
      if (message.locationId !== locationId) continue;
      try {
        socket.send(serialized);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }
}
