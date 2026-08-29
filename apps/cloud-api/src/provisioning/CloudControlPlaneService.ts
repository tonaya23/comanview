import { randomBytes, randomUUID } from 'node:crypto';
import type {
  CanonicalLocationRecord,
  CanonicalTenantRecord,
  CloudAdminMutationActor,
  CloudControlPlaneRepository,
  EdgeReplacementRecord,
  ProvisionedEdgeRecord,
} from '@comanview/database';
import type { CloudProvisioningConfig } from '@comanview/config';
import { hashEdgeToken } from '../auth/EdgeAuthenticator.js';
import { CloudError } from '../app/CloudError.js';

export class CloudControlPlaneService {
  constructor(
    private readonly repository: CloudControlPlaneRepository,
    private readonly config: CloudProvisioningConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly assertLicensedBeforeProvisioning?: (locationId: string) => Promise<void>,
  ) {}

  listTenants(global: boolean, tenantIds: string[]) { return this.repository.listTenants(global, tenantIds); }
  listLocations(tenantId: string) { return this.repository.listLocations(tenantId); }
  listEdges(locationId: string) { return this.repository.listEdges(locationId); }
  getLocation(locationId: string) { return this.repository.getLocation(locationId); }
  getProvisioningCode(codeId: string) { return this.repository.getProvisioningCode(codeId); }
  getReplacement(replacementId: string) { return this.repository.getReplacement(replacementId); }
  getPendingReplacement(locationId: string) { return this.repository.getPendingReplacement(locationId); }

  async createTenant(input: { commandId: string; tenantId?: string | undefined; displayName: string }, actor: CloudAdminMutationActor) {
    return this.idempotent<CanonicalTenantRecord>(input.commandId, reviveTenant, () => this.repository.createTenant({
      tenantId: input.tenantId ?? randomUUID(), displayName: input.displayName,
      commandId: input.commandId, actor, now: this.now(),
    }));
  }

  async createLocation(tenantId: string, input: { commandId: string; locationId?: string | undefined; displayName: string; timezone: string }, actor: CloudAdminMutationActor) {
    assertIanaTimezone(input.timezone);
    return this.idempotent<CanonicalLocationRecord>(input.commandId, reviveLocation, () => this.repository.createLocation({
      tenantId, locationId: input.locationId ?? randomUUID(), displayName: input.displayName,
      timezone: input.timezone, commandId: input.commandId, actor, now: this.now(),
    }));
  }

  async generateCode(locationId: string, commandId: string, actor: CloudAdminMutationActor) {
    await this.assertLicensedBeforeProvisioning?.(locationId);
    const prior = await this.repository.findIdempotentResult(commandId);
    if (prior) throw new CloudError('PROVISIONING_CODE_ALREADY_DELIVERED', 409,
      'This command already generated a code; create a new command because plaintext secrets are never persisted.');
    const code = randomBytes(24).toString('base64url');
    const now = this.now();
    const record = await this.repository.createProvisioningCode({
      provisioningCodeId: randomUUID(), locationId, codeHash: hashEdgeToken(code),
      expiresAt: new Date(now.getTime() + this.config.codeTtlMs), commandId, actor, now,
    });
    return { ...record, code };
  }

  revokeCode(codeId: string, commandId: string, actor: CloudAdminMutationActor) {
    return this.idempotent(commandId, reviveCode, () => this.repository.revokeProvisioningCode({ codeId, commandId, actor, now: this.now() }));
  }

  async exchange(input: { attemptId: string; edgeId: string; credentialId: string; provisioningCode: string; credential: string }) {
    return this.repository.exchangeProvisioningCode({
      attemptId: input.attemptId, edgeId: input.edgeId, credentialId: input.credentialId,
      codeHash: hashEdgeToken(input.provisioningCode), credentialHash: hashEdgeToken(input.credential), now: this.now(),
    });
  }

  async activate(input: { commandId: string; attemptId: string; edgeId: string }, credential: string) {
    const pending = await this.repository.getProvisioningCredential(input.edgeId, hashEdgeToken(credential));
    if (!pending || pending.attemptId !== input.attemptId) throw unauthorized();
    return this.repository.activateProvisionedEdge({ ...input, credentialId: pending.credentialId, now: this.now() });
  }

  revokeEdge(edgeId: string, input: { commandId: string; reason: string }, actor: CloudAdminMutationActor) {
    return this.idempotent(input.commandId, reviveEdge, () => this.repository.revokeEdge({ edgeId, ...input, actor, now: this.now() }));
  }

  async initiateReplacement(locationId: string, input: { commandId: string; oldEdgeId: string; reason: string }, actor: CloudAdminMutationActor) {
    await this.assertLicensedBeforeProvisioning?.(locationId);
    const location = await this.repository.getLocation(locationId);
    if (!location) throw new CloudError('CLOUD_RESOURCE_NOT_FOUND', 404, 'Resource was not found.');
    const prior = await this.repository.findIdempotentResult(input.commandId);
    if (prior) throw new CloudError('PROVISIONING_CODE_ALREADY_DELIVERED', 409,
      'This command already generated a code; create a new command because plaintext secrets are never persisted.');
    const code = randomBytes(24).toString('base64url');
    const now = this.now();
    const result = await this.repository.initiateReplacement({
      replacementId: randomUUID(), oldEdgeId: input.oldEdgeId, provisioningCodeId: randomUUID(),
      codeHash: hashEdgeToken(code), expiresAt: new Date(now.getTime() + this.config.codeTtlMs),
      reason: input.reason, commandId: input.commandId, actor, now,
    });
    return { replacementId: result.replacementId, provisioningCode: { ...result.code, code } };
  }

  cancelReplacement(replacementId: string, input: { commandId: string; reason: string }, actor: CloudAdminMutationActor) {
    return this.idempotent(input.commandId, reviveReplacement, () => this.repository.cancelReplacement({
      replacementId, ...input, actor, now: this.now(),
    }));
  }

  async registerRotation(edgeId: string, input: { rotationId: string; credentialId: string; credential: string }) {
    return this.repository.registerRotation({ edgeId, rotationId: input.rotationId,
      credentialId: input.credentialId, credentialHash: hashEdgeToken(input.credential), now: this.now() });
  }

  async confirmRotation(rotationId: string, input: { commandId: string; edgeId: string }, credential: string) {
    const pending = await this.repository.getPendingRotationCredential(input.edgeId, rotationId, hashEdgeToken(credential));
    if (!pending) throw unauthorized();
    return this.repository.confirmRotation({ edgeId: input.edgeId, rotationId,
      credentialId: pending.credentialId, commandId: input.commandId,
      overlapMs: this.config.credentialRotationOverlapMs, now: this.now() });
  }

  private async idempotent<T>(commandId: string, revive: (value: Record<string, unknown>) => T, execute: () => Promise<T>): Promise<T> {
    const existing = await this.repository.findIdempotentResult(commandId);
    return existing ? revive(existing) : execute();
  }
}

export function bearerCredential(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) throw unauthorized();
  const credential = value.slice(7).trim();
  if (credential.length < 32) throw unauthorized();
  return credential;
}

function assertIanaTimezone(value: string): void {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); }
  catch { throw new CloudError('INVALID_TIMEZONE', 422, 'Timezone must be a valid IANA timezone.'); }
}
function unauthorized() { return new CloudError('EDGE_AUTH_INVALID', 401, 'Edge credentials are invalid.'); }

function dateValue(value: unknown): Date { return new Date(String(value)); }
function reviveTenant(value: Record<string, unknown>): CanonicalTenantRecord {
  return { tenantId: String(value['tenantId']), displayName: value['displayName'] === null ? null : String(value['displayName']),
    status: value['status'] as 'ACTIVE' | 'INACTIVE', createdAt: dateValue(value['createdAt']) };
}
function reviveLocation(value: Record<string, unknown>): CanonicalLocationRecord {
  return { tenantId: String(value['tenantId']), locationId: String(value['locationId']),
    displayName: value['displayName'] === null ? null : String(value['displayName']), timezone: value['timezone'] === null ? null : String(value['timezone']),
    status: value['status'] as 'ACTIVE' | 'INACTIVE', configurationStatus: value['configurationStatus'] as 'COMPLETE' | 'PENDING_CONFIGURATION', createdAt: dateValue(value['createdAt']) };
}
function reviveCode(value: Record<string, unknown>) {
  return { provisioningCodeId: String(value['provisioningCodeId']), tenantId: String(value['tenantId']), locationId: String(value['locationId']),
    status: value['status'] as 'ISSUED' | 'CONSUMED' | 'REVOKED', createdAt: dateValue(value['createdAt']), expiresAt: dateValue(value['expiresAt']) };
}
function reviveEdge(value: Record<string, unknown>): ProvisionedEdgeRecord {
  const optionalDate = (item: unknown) => item ? dateValue(item) : null;
  return { edgeId: String(value['edgeId']), tenantId: String(value['tenantId']), locationId: String(value['locationId']),
    status: value['status'] as ProvisionedEdgeRecord['status'], provisionedAt: optionalDate(value['provisionedAt']),
    activatedAt: optionalDate(value['activatedAt']), revokedAt: optionalDate(value['revokedAt']), replacedAt: optionalDate(value['replacedAt']),
    replacedByEdgeId: value['replacedByEdgeId'] ? String(value['replacedByEdgeId']) : null };
}
function reviveReplacement(value: Record<string, unknown>): EdgeReplacementRecord {
  const code = value['provisioningCode'] as Record<string, unknown>;
  const optionalDate = (item: unknown) => item ? dateValue(item) : null;
  return {
    replacementId: String(value['replacementId']), tenantId: String(value['tenantId']),
    locationId: String(value['locationId']), oldEdgeId: String(value['oldEdgeId']),
    newEdgeId: value['newEdgeId'] ? String(value['newEdgeId']) : null,
    status: value['status'] as EdgeReplacementRecord['status'], reason: String(value['reason']),
    initiatedAt: dateValue(value['initiatedAt']), completedAt: optionalDate(value['completedAt']),
    cancelledAt: optionalDate(value['cancelledAt']),
    provisioningCode: {
      provisioningCodeId: String(code['provisioningCodeId']), tenantId: String(code['tenantId']),
      locationId: String(code['locationId']),
      status: code['status'] as EdgeReplacementRecord['provisioningCode']['status'],
      createdAt: dateValue(code['createdAt']), expiresAt: dateValue(code['expiresAt']),
    },
  };
}

export function tenantResponse(record: CanonicalTenantRecord) {
  return { ...record, createdAt: record.createdAt.toISOString() };
}
export function canonicalLocationResponse(record: CanonicalLocationRecord) {
  return { ...record, createdAt: record.createdAt.toISOString() };
}
export function provisionedEdgeResponse(record: ProvisionedEdgeRecord) {
  return { ...record, provisionedAt: record.provisionedAt?.toISOString() ?? null,
    activatedAt: record.activatedAt?.toISOString() ?? null, revokedAt: record.revokedAt?.toISOString() ?? null,
    replacedAt: record.replacedAt?.toISOString() ?? null };
}
export function provisioningCodeResponse(record: { createdAt: Date; expiresAt: Date }) {
  return { ...record, createdAt: record.createdAt.toISOString(), expiresAt: record.expiresAt.toISOString() };
}
