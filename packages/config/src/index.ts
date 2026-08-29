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
  licensing: EdgeLicensingConfig;
}

export interface EdgeLicensingConfig {
  enforcementEnabled: boolean;
  publicKeyring: Record<string, string>;
  pullIntervalMs: number;
  maxBackoffMs: number;
  checkpointIntervalMs: number;
}

export function loadEdgeSyncConfig(environment: NodeJS.ProcessEnv = process.env): EdgeSyncConfig {
  const explicitlyEnabled = booleanFromEnvironment
    .optional()
    .parse(environment['COMANVIEW_SYNC_ENABLED']);
  const cloudUrl = environment['COMANVIEW_CLOUD_URL']?.trim() || null;
  const rawToken = environment['COMANVIEW_EDGE_SYNC_TOKEN']?.trim() || null;
  if (environment['NODE_ENV'] === 'production' && rawToken) {
    throw new Error('COMANVIEW_EDGE_SYNC_TOKEN is a legacy development bootstrap and is forbidden in production.');
  }
  if (environment['NODE_ENV'] === 'production' && environment['COMANVIEW_EDGE_ID']) {
    throw new Error('COMANVIEW_EDGE_ID bootstrap is forbidden in production; use durable provisioning.');
  }
  const enabled = explicitlyEnabled ?? Boolean(cloudUrl && rawToken);
  if (enabled && !cloudUrl) {
    throw new Error('COMANVIEW_CLOUD_URL is required when sync is enabled.');
  }
  const token = enabled && rawToken ? z.string().min(16).parse(rawToken) : rawToken;
  let publicKeyring: Record<string, string> = {};
  if (environment['COMANVIEW_LICENSE_PUBLIC_KEYRING']) {
    try {
      publicKeyring = z.record(z.string().min(1), z.string().min(40)).parse(
        JSON.parse(environment['COMANVIEW_LICENSE_PUBLIC_KEYRING']),
      );
    } catch {
      throw new Error('COMANVIEW_LICENSE_PUBLIC_KEYRING must be a JSON object of kid to PEM public key.');
    }
  }
  const enforcementEnabled = booleanFromEnvironment.default(
    environment['NODE_ENV'] === 'production' ? 'true' : 'false',
  ).parse(environment['COMANVIEW_LICENSE_ENFORCEMENT_ENABLED']);
  if (enforcementEnabled && Object.keys(publicKeyring).length === 0) {
    throw new Error('COMANVIEW_LICENSE_PUBLIC_KEYRING is required when licensing enforcement is enabled.');
  }
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
    schemaVersion: environment['COMANVIEW_EDGE_SCHEMA_VERSION']?.trim() || '12',
    licensing: {
      enforcementEnabled,
      publicKeyring,
      pullIntervalMs: optionalPositiveInteger(300_000, 3_600_000).parse(
        environment['COMANVIEW_CONTROL_PULL_INTERVAL_MS'],
      ),
      maxBackoffMs: optionalPositiveInteger(3_600_000, 86_400_000).parse(
        environment['COMANVIEW_CONTROL_PULL_MAX_BACKOFF_MS'],
      ),
      checkpointIntervalMs: optionalPositiveInteger(60_000, 300_000).parse(
        environment['COMANVIEW_LICENSE_CHECKPOINT_INTERVAL_MS'],
      ),
    },
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
  admin: CloudAdminConfig;
  provisioning: CloudProvisioningConfig;
  licensing: CloudLicensingConfig | null;
}

export interface CloudLicensingConfig {
  signingKid: string;
  privateKeyPem: string;
}

export interface CloudProvisioningConfig {
  codeTtlMs: number;
  credentialRotationOverlapMs: number;
}

export interface CloudAdminConfig {
  environment: 'development' | 'test' | 'production';
  sessionTtlMs: number;
  idleTimeoutMs: number;
  maxFailedLoginAttempts: number;
  loginLockoutMs: number;
  heartbeatStaleThresholdMs: number;
  projectionLagThresholdMs: number;
  projectionVersion: number;
  secureCookie: boolean;
  developmentBootstrap: {
    email: string;
    password: string;
    displayName: string;
    role: 'PLATFORM_ADMIN' | 'PLATFORM_ADMIN_READ' | 'SUPPORT_READ';
    tenantIds: string[];
  } | null;
}

export interface CloudWorkerConfig {
  databaseUrl: string;
  projectionVersion: number;
  pollIntervalMs: number;
  leaseDurationMs: number;
  batchSize: number;
  maxAttempts: number;
}

export function loadCloudWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CloudWorkerConfig {
  return {
    databaseUrl: z.string().url().parse(environment['DATABASE_URL']),
    projectionVersion: optionalPositiveInteger(1, 1_000).parse(
      environment['COMANVIEW_CLOUD_PROJECTION_VERSION'],
    ),
    pollIntervalMs: optionalPositiveInteger(1_000, 60_000).parse(
      environment['COMANVIEW_CLOUD_WORKER_POLL_INTERVAL_MS'],
    ),
    leaseDurationMs: optionalPositiveInteger(30_000, 600_000).parse(
      environment['COMANVIEW_CLOUD_WORKER_LEASE_MS'],
    ),
    batchSize: optionalPositiveInteger(25, 100).parse(
      environment['COMANVIEW_CLOUD_WORKER_BATCH_SIZE'],
    ),
    maxAttempts: optionalPositiveInteger(3, 20).parse(
      environment['COMANVIEW_CLOUD_WORKER_MAX_ATTEMPTS'],
    ),
  };
}

export function loadCloudConfig(environment: NodeJS.ProcessEnv = process.env): CloudConfig {
  const credentialsText = environment['COMANVIEW_CLOUD_EDGE_CREDENTIALS'] ?? '[]';
  let credentials: unknown;
  try {
    credentials = JSON.parse(credentialsText);
  } catch {
    throw new Error('COMANVIEW_CLOUD_EDGE_CREDENTIALS must be valid JSON.');
  }
  const edgeCredentials = z.array(CloudEdgeCredentialSchema).parse(credentials);
  const nodeEnvironment = z
    .enum(['development', 'test', 'production'])
    .default('development')
    .parse(environment['NODE_ENV']);
  if (nodeEnvironment === 'production' && edgeCredentials.length > 0) {
    throw new Error('COMANVIEW_CLOUD_EDGE_CREDENTIALS is forbidden in production.');
  }
  const bootstrapEmail = environment['COMANVIEW_CLOUD_DEV_ADMIN_EMAIL']?.trim();
  const bootstrapPassword = environment['COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD'];
  if (nodeEnvironment === 'production' && (bootstrapEmail || bootstrapPassword)) {
    throw new Error('Development Cloud Admin bootstrap is forbidden in production.');
  }
  if (Boolean(bootstrapEmail) !== Boolean(bootstrapPassword)) {
    throw new Error(
      'COMANVIEW_CLOUD_DEV_ADMIN_EMAIL and COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD must be configured together.',
    );
  }
  let tenantIds: string[] = [];
  if (environment['COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS']) {
    try {
      tenantIds = z
        .array(z.string().uuid())
        .parse(JSON.parse(environment['COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS']));
    } catch {
      throw new Error('COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS must be a JSON UUID array.');
    }
  }
  const role = z
    .enum(['PLATFORM_ADMIN', 'PLATFORM_ADMIN_READ', 'SUPPORT_READ'])
    .default('PLATFORM_ADMIN')
    .parse(environment['COMANVIEW_CLOUD_DEV_ADMIN_ROLE']);
  const signingKid = environment['COMANVIEW_CLOUD_SIGNING_KID']?.trim();
  const privateKeyPem = environment['COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM']?.replace(/\\n/g, '\n');
  if (Boolean(signingKid) !== Boolean(privateKeyPem)) {
    throw new Error('COMANVIEW_CLOUD_SIGNING_KID and COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM must be configured together.');
  }
  if (nodeEnvironment === 'production' && (!signingKid || !privateKeyPem)) {
    throw new Error('Cloud signing key deployment secrets are required in production.');
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
    edgeCredentials,
    licensing: signingKid && privateKeyPem ? { signingKid, privateKeyPem } : null,
    provisioning: {
      codeTtlMs: optionalPositiveInteger(1_800_000, 86_400_000).parse(
        environment['COMANVIEW_CLOUD_PROVISIONING_CODE_TTL_MS'],
      ),
      credentialRotationOverlapMs: optionalPositiveInteger(300_000, 86_400_000).parse(
        environment['COMANVIEW_CLOUD_CREDENTIAL_ROTATION_OVERLAP_MS'],
      ),
    },
    admin: {
      environment: nodeEnvironment,
      sessionTtlMs: optionalPositiveInteger(28_800_000, 604_800_000).parse(
        environment['COMANVIEW_CLOUD_ADMIN_SESSION_TTL_MS'],
      ),
      idleTimeoutMs: optionalPositiveInteger(1_800_000, 86_400_000).parse(
        environment['COMANVIEW_CLOUD_ADMIN_IDLE_TIMEOUT_MS'],
      ),
      maxFailedLoginAttempts: optionalPositiveInteger(5, 20).parse(
        environment['COMANVIEW_CLOUD_ADMIN_MAX_LOGIN_ATTEMPTS'],
      ),
      loginLockoutMs: optionalPositiveInteger(900_000, 86_400_000).parse(
        environment['COMANVIEW_CLOUD_ADMIN_LOCKOUT_MS'],
      ),
      heartbeatStaleThresholdMs: optionalPositiveInteger(90_000, 3_600_000).parse(
        environment['COMANVIEW_CLOUD_HEARTBEAT_STALE_MS'],
      ),
      projectionLagThresholdMs: optionalPositiveInteger(120_000, 3_600_000).parse(
        environment['COMANVIEW_CLOUD_PROJECTION_LAG_MS'],
      ),
      projectionVersion: optionalPositiveInteger(1, 1_000).parse(
        environment['COMANVIEW_CLOUD_PROJECTION_VERSION'],
      ),
      secureCookie: nodeEnvironment !== 'development',
      developmentBootstrap:
        bootstrapEmail && bootstrapPassword
          ? {
              email: z.string().email().parse(bootstrapEmail),
              password: z.string().min(12).max(200).parse(bootstrapPassword),
              displayName:
                environment['COMANVIEW_CLOUD_DEV_ADMIN_DISPLAY_NAME']?.trim() ||
                'Cloud Admin Development',
              role,
              tenantIds,
            }
          : null,
    },
  };
}
