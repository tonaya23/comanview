import {
  EdgeControlStateResponseSchema,
} from '@comanview/contracts';
import type { z } from 'zod';

export type EdgeControlState = z.infer<typeof EdgeControlStateResponseSchema>;

export type ControlTransportStage =
  | 'PULL_REQUEST'
  | 'PULL_HTTP'
  | 'PULL_RESPONSE'
  | 'ACK_REQUEST'
  | 'ACK_HTTP';

export class ControlTransportError extends Error {
  constructor(
    readonly code: string,
    readonly stage: ControlTransportStage,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'ControlTransportError';
  }
}

export class HttpControlTransport {
  constructor(
    private readonly cloudUrl: string,
    private readonly edgeId: string,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {}

  async pull(): Promise<EdgeControlState> {
    return this.request('GET', '/edge/v1/control-state', undefined, EdgeControlStateResponseSchema);
  }

  async acknowledge(body: unknown): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.cloudUrl}/edge/v1/control-state/acks`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw networkError('ACK', error);
    }
    if (!response.ok) {
      throw new ControlTransportError(`CONTROL_ACK_HTTP_${response.status}`, 'ACK_HTTP', response.status);
    }
  }

  private async request<T>(method: string, path: string, body: unknown,
    schema: { parse(value: unknown): T }): Promise<T> {
    const init: RequestInit = { method, headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await fetch(`${this.cloudUrl}${path}`, init);
    } catch (error) {
      throw networkError('PULL', error);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ControlTransportError(`CONTROL_PULL_HTTP_${response.status}`, 'PULL_HTTP', response.status);
    }
    try {
      return schema.parse(payload);
    } catch {
      throw new ControlTransportError('CONTROL_PULL_RESPONSE_INVALID', 'PULL_RESPONSE');
    }
  }

  private headers() {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json',
      'x-comanview-edge-id': this.edgeId };
  }
}

function networkError(operation: 'PULL' | 'ACK', error: unknown): ControlTransportError {
  const timeout = error instanceof Error && error.name === 'TimeoutError';
  return new ControlTransportError(
    `CONTROL_${operation}_${timeout ? 'TIMEOUT' : 'NETWORK_ERROR'}`,
    `${operation}_REQUEST`,
  );
}
