import {
  HeartbeatAckSchema,
  SyncBatchAckSchema,
  type EdgeHeartbeat,
  type HeartbeatAck,
  type SyncBatchAck,
  type SyncBatchRequest,
} from '@comanview/sync';

export class CloudTransportError extends Error {
  constructor(
    public readonly statusCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'CloudTransportError';
  }
}

export interface CloudSyncTransport {
  sendBatch(batch: SyncBatchRequest): Promise<SyncBatchAck>;
  sendHeartbeat(heartbeat: EdgeHeartbeat): Promise<HeartbeatAck>;
}

export class HttpCloudSyncTransport implements CloudSyncTransport {
  constructor(
    private readonly cloudUrl: string,
    private readonly edgeId: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  sendBatch(batch: SyncBatchRequest): Promise<SyncBatchAck> {
    return this.request('/sync/v1/events', batch, SyncBatchAckSchema);
  }

  sendHeartbeat(heartbeat: EdgeHeartbeat): Promise<HeartbeatAck> {
    return this.request('/sync/v1/heartbeat', heartbeat, HeartbeatAckSchema);
  }

  private async request<T>(
    path: string,
    body: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    try {
      const response = await fetch(`${this.cloudUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          'x-comanview-edge-id': this.edgeId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'message' in payload
            ? String(payload.message)
            : `Cloud returned HTTP ${response.status}.`;
        throw new CloudTransportError(response.status, message);
      }
      return schema.parse(payload);
    } catch (error) {
      if (error instanceof CloudTransportError) throw error;
      throw new CloudTransportError(
        null,
        error instanceof Error ? error.message : 'Cloud request failed.',
      );
    }
  }
}
