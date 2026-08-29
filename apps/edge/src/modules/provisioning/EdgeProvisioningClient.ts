import { randomBytes, randomUUID } from 'node:crypto';
import type { SyncOutboxRepository } from '@comanview/database';
import { ProvisioningExchangeResponseSchema, ProvisioningActivateResponseSchema } from '@comanview/contracts';
import type { EdgeSecretStore } from './EdgeSecretStore.js';

export class EdgeProvisioningClient {
  constructor(private readonly repository: SyncOutboxRepository, private readonly secrets: EdgeSecretStore,
    private readonly cloudUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async provision(code: string) {
    const journal = this.repository.getProvisioningJournal();
    const secretState = await this.secrets.load();
    const edgeId = journal?.edgeId ?? randomUUID();
    const attemptId = journal?.attemptId ?? randomUUID();
    const credentialId = journal?.credentialId ?? randomUUID();
    const credential = secretState.pending?.credential ?? randomBytes(32).toString('base64url');
    this.repository.beginProvisioning({ edgeId, attemptId, credentialId });
    if (!secretState.pending) await this.secrets.save({ ...secretState, pending: { credentialId, credential } });
    const exchange = ProvisioningExchangeResponseSchema.parse(await this.request('/provisioning/v1/exchange', {
      attemptId, edgeId, credentialId, provisioningCode: code, credential,
    }));
    this.repository.recordProvisioningExchange({ tenantId: exchange.edge.tenantId, locationId: exchange.edge.locationId });
    const activation = ProvisioningActivateResponseSchema.parse(await this.request('/provisioning/v1/activate', {
      commandId: randomUUID(), attemptId, edgeId,
    }, credential, edgeId));
    this.repository.markProvisioningActive();
    await this.secrets.save({ active: { credentialId, credential }, pending: null });
    return activation.edge;
  }

  async rotate(edgeId: string) {
    const state = await this.secrets.load();
    if (!state.active) throw new Error('No active Edge credential is available for rotation.');
    const pending = state.pending ?? { credentialId: randomUUID(), credential: randomBytes(32).toString('base64url'), rotationId: randomUUID() };
    const rotationId = pending.rotationId ?? randomUUID();
    if (!state.pending?.rotationId) await this.secrets.save({ ...state, pending: { ...pending, rotationId } });
    await this.request('/edge/v1/credentials/rotations', {
      rotationId, credentialId: pending.credentialId, credential: pending.credential,
    }, state.active.credential, edgeId);
    await this.request(`/edge/v1/credentials/rotations/${rotationId}/confirm`, {
      commandId: randomUUID(), edgeId,
    }, pending.credential, edgeId);
    await this.secrets.save({ active: { credentialId: pending.credentialId, credential: pending.credential }, pending: null });
    return { rotationId, credentialId: pending.credentialId };
  }

  private async request(path: string, body: unknown, credential?: string, edgeId?: string) {
    const response = await this.fetcher(`${this.cloudUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(edgeId ? { 'x-comanview-edge-id': edgeId } : {}) }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Cloud provisioning failed (${response.status}): ${(result as { error?: string }).error ?? 'UNKNOWN'}`);
    return result;
  }
}
