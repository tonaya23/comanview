/**
 * @comanview/config
 *
 * Runtime configuration schemas and loaders (Zod-validated).
 * Used by Edge and Cloud to validate environment variables at startup.
 */

import { z } from 'zod';

const booleanFromEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

const optionalPositiveInteger = (fallback: number, maximum: number) =>
  z.coerce.number().int().positive().max(maximum).default(fallback);

export interface EdgeSyncConfig {
  enabled: boolean;
  cloudUrl: string | null;
  token: string | null;
  configuredEdgeId: string | null;
  batchSize: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  edgeVersion: string;
  schemaVersion: string;
}

export function loadEdgeSyncConfig(environment: NodeJS.ProcessEnv = process.env): EdgeSyncConfig {
  const explicitlyEnabled = booleanFromEnvironment
    .optional()
    .parse(environment['COMANVIEW_SYNC_ENABLED']);
  const cloudUrl = environment['COMANVIEW_CLOUD_URL']?.trim() || null;
  const rawToken = environment['COMANVIEW_EDGE_SYNC_TOKEN']?.trim() || null;
  const enabled = explicitlyEnabled ?? Boolean(cloudUrl && rawToken);
  if (enabled && (!cloudUrl || !rawToken)) {
    throw new Error(
      'COMANVIEW_CLOUD_URL and COMANVIEW_EDGE_SYNC_TOKEN are required when sync is enabled.',
    );
  }
  const token = enabled && rawToken ? z.string().min(16).parse(rawToken) : rawToken;
  return {
    enabled,
    cloudUrl: cloudUrl ? z.string().url().parse(cloudUrl).replace(/\/$/, '') : null,
    token,
    configuredEdgeId: environment['COMANVIEW_EDGE_ID']?.trim() || null,
    batchSize: optionalPositiveInteger(50, 100).parse(environment['COMANVIEW_SYNC_BATCH_SIZE']),
    pollIntervalMs: optionalPositiveInteger(5_000, 3_600_000).parse(
      environment['COMANVIEW_SYNC_POLL_INTERVAL_MS'],
    ),
    requestTimeoutMs: optionalPositiveInteger(5_000, 120_000).parse(
      environment['COMANVIEW_SYNC_TIMEOUT_MS'],
    ),
    leaseDurationMs: optionalPositiveInteger(60_000, 3_600_000).parse(
      environment['COMANVIEW_SYNC_LEASE_MS'],
    ),
    heartbeatIntervalMs: optionalPositiveInteger(30_000, 3_600_000).parse(
      environment['COMANVIEW_HEARTBEAT_INTERVAL_MS'],
    ),
    edgeVersion: environment['COMANVIEW_EDGE_VERSION']?.trim() || '0.0.0-dev',
    schemaVersion: environment['COMANVIEW_EDGE_SCHEMA_VERSION']?.trim() || '10',
  };
}

export const CloudEdgeCredentialSchema = z.object({
  edgeId: z.string().uuid(),
  tenantId: z.string().uuid(),
  locationId: z.string().uuid(),
  token: z.string().min(16),
});
export type CloudEdgeCredential = z.infer<typeof CloudEdgeCredentialSchema>;

export interface CloudConfig {
  databaseUrl: string;
  port: number;
  host: string;
  bodyLimit: number;
  maxBatchSize: number;
  edgeCredentials: CloudEdgeCredential[];
}

export function loadCloudConfig(environment: NodeJS.ProcessEnv = process.env): CloudConfig {
  const credentialsText = environment['COMANVIEW_CLOUD_EDGE_CREDENTIALS'] ?? '[]';
  let credentials: unknown;
  try {
    credentials = JSON.parse(credentialsText);
  } catch {
    throw new Error('COMANVIEW_CLOUD_EDGE_CREDENTIALS must be valid JSON.');
  }
  return {
    databaseUrl: z.string().url().parse(environment['DATABASE_URL']),
    port: optionalPositiveInteger(4000, 65_535).parse(environment['COMANVIEW_CLOUD_PORT']),
    host: environment['COMANVIEW_CLOUD_HOST']?.trim() || '127.0.0.1',
    bodyLimit: optionalPositiveInteger(1_048_576, 10_485_760).parse(
      environment['COMANVIEW_CLOUD_BODY_LIMIT'],
    ),
    maxBatchSize: optionalPositiveInteger(100, 100).parse(
      environment['COMANVIEW_CLOUD_SYNC_MAX_BATCH_SIZE'],
    ),
    edgeCredentials: z.array(CloudEdgeCredentialSchema).parse(credentials),
  };
}
