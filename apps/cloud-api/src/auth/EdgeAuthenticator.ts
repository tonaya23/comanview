import { createHash, timingSafeEqual } from 'node:crypto';
import type { CloudEdgeRecord } from '@comanview/database';
import { CloudError } from '../app/CloudError.js';

export interface EdgeLookup {
  getEdge(edgeId: string): Promise<CloudEdgeRecord | null>;
}

export function hashEdgeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function safeHashEquals(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class EdgeAuthenticator {
  constructor(private readonly edges: EdgeLookup) {}

  async authenticate(edgeIdHeader: unknown, authorization: unknown): Promise<CloudEdgeRecord> {
    if (typeof edgeIdHeader !== 'string' || !edgeIdHeader) {
      throw new CloudError('EDGE_AUTH_REQUIRED', 401, 'Edge authentication is required.');
    }
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw new CloudError('EDGE_AUTH_REQUIRED', 401, 'Edge authentication is required.');
    }
    const token = authorization.slice('Bearer '.length).trim();
    const edge = await this.edges.getEdge(edgeIdHeader);
    if (
      !token ||
      !edge ||
      edge.status !== 'ACTIVE' ||
      !safeHashEquals(hashEdgeToken(token), edge.credentialHash)
    ) {
      throw new CloudError('EDGE_AUTH_INVALID', 401, 'Edge credential is invalid.');
    }
    return edge;
  }
}
