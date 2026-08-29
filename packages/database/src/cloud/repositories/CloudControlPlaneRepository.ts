import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface CloudAdminMutationActor {
  userId: string;
  sessionId: string;
}

export interface CanonicalTenantRecord {
  tenantId: string;
  displayName: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
}

export interface CanonicalLocationRecord {
  tenantId: string;
  locationId: string;
  displayName: string | null;
  timezone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  configurationStatus: 'COMPLETE' | 'PENDING_CONFIGURATION';
  createdAt: Date;
}

export interface ProvisionedEdgeRecord {
  edgeId: string;
  tenantId: string;
  locationId: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'REVOKED' | 'REPLACED';
  provisionedAt: Date | null;
  activatedAt: Date | null;
  revokedAt: Date | null;
  replacedAt: Date | null;
  replacedByEdgeId: string | null;
}

export interface ProvisioningCodeRecord {
  provisioningCodeId: string;
  tenantId: string;
  locationId: string;
  status: 'ISSUED' | 'CONSUMED' | 'REVOKED';
  createdAt: Date;
  expiresAt: Date;
}

export interface ProvisioningExchangeResult {
  attemptId: string;
  credentialId: string;
  edge: ProvisionedEdgeRecord;
  replacement: boolean;
}

export interface EdgeReplacementRecord {
  replacementId: string;
  tenantId: string;
  locationId: string;
  oldEdgeId: string;
  newEdgeId: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  reason: string;
  initiatedAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
  provisioningCode: ProvisioningCodeRecord;
}

export class CloudControlPlaneRepository {
  constructor(private readonly pool: Pool) {}

  async findIdempotentResult(commandId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{ after_state: Record<string, unknown> | null }>(
      'SELECT after_state FROM cloud_admin_audit_log WHERE command_id = $1',
      [commandId],
    );
    return result.rows[0]?.after_state ?? null;
  }

  async listTenants(global: boolean, tenantIds: string[]): Promise<CanonicalTenantRecord[]> {
    const result = await this.pool.query<{
      tenant_id: string; display_name: string | null; status: 'ACTIVE' | 'INACTIVE'; created_at: Date;
    }>(
      `SELECT tenant_id, display_name, status, created_at
       FROM cloud_tenants
       WHERE ($1::boolean OR tenant_id = ANY($2::uuid[]))
       ORDER BY display_name NULLS LAST, tenant_id`,
      [global, tenantIds],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id, displayName: row.display_name, status: row.status, createdAt: row.created_at,
    }));
  }

  async listLocations(tenantId: string): Promise<CanonicalLocationRecord[]> {
    const result = await this.pool.query<{
      tenant_id: string; location_id: string; display_name: string | null; timezone: string | null;
      status: 'ACTIVE' | 'INACTIVE'; configuration_status: 'COMPLETE' | 'PENDING_CONFIGURATION'; created_at: Date;
    }>(
      `SELECT tenant_id, location_id, display_name, timezone, status, configuration_status, created_at
       FROM cloud_locations WHERE tenant_id = $1 ORDER BY display_name NULLS LAST, location_id`,
      [tenantId],
    );
    return result.rows.map(mapLocation);
  }

  async listEdges(locationId: string): Promise<ProvisionedEdgeRecord[]> {
    const result = await this.pool.query<EdgeRow>(
      `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
              revoked_at, replaced_at, replaced_by_edge_id
       FROM edges WHERE location_id = $1 ORDER BY created_at`,
      [locationId],
    );
    return result.rows.map(mapEdge);
  }

  async getLocation(locationId: string): Promise<CanonicalLocationRecord | null> {
    const result = await this.pool.query<{
      tenant_id: string; location_id: string; display_name: string | null; timezone: string | null;
      status: 'ACTIVE' | 'INACTIVE'; configuration_status: 'COMPLETE' | 'PENDING_CONFIGURATION'; created_at: Date;
    }>(
      `SELECT tenant_id, location_id, display_name, timezone, status, configuration_status, created_at
       FROM cloud_locations WHERE location_id = $1`,
      [locationId],
    );
    return result.rows[0] ? mapLocation(result.rows[0]) : null;
  }

  async createTenant(input: {
    tenantId: string; displayName: string; commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<CanonicalTenantRecord> {
    return this.transaction(async (client) => {
      const result = await client.query<{
        tenant_id: string; display_name: string; status: 'ACTIVE'; created_at: Date;
      }>(
        `INSERT INTO cloud_tenants (tenant_id, display_name, status, created_at, updated_at)
         VALUES ($1,$2,'ACTIVE',$3,$3)
         RETURNING tenant_id, display_name, status, created_at`,
        [input.tenantId, input.displayName, input.now],
      );
      const tenant = {
        tenantId: result.rows[0]!.tenant_id,
        displayName: result.rows[0]!.display_name,
        status: result.rows[0]!.status,
        createdAt: result.rows[0]!.created_at,
      } satisfies CanonicalTenantRecord;
      await appendAudit(client, {
        actor: input.actor, action: 'TENANT_CREATED', entityType: 'TENANT', entityId: tenant.tenantId,
        tenantId: tenant.tenantId, commandId: input.commandId, after: tenant, now: input.now,
      });
      return tenant;
    });
  }

  async createLocation(input: {
    tenantId: string; locationId: string; displayName: string; timezone: string;
    commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<CanonicalLocationRecord> {
    return this.transaction(async (client) => {
      const result = await client.query<{
        tenant_id: string; location_id: string; display_name: string; timezone: string;
        status: 'ACTIVE'; configuration_status: 'COMPLETE'; created_at: Date;
      }>(
        `INSERT INTO cloud_locations
           (location_id, tenant_id, display_name, timezone, status, configuration_status, created_at, updated_at)
         SELECT $2, tenant_id, $3, $4, 'ACTIVE', 'COMPLETE', $5, $5
         FROM cloud_tenants WHERE tenant_id = $1 AND status = 'ACTIVE'
         RETURNING tenant_id, location_id, display_name, timezone, status, configuration_status, created_at`,
        [input.tenantId, input.locationId, input.displayName, input.timezone, input.now],
      );
      if (!result.rows[0]) throw new ControlPlaneConflictError('TENANT_NOT_ACTIVE');
      const location = mapLocation(result.rows[0]);
      await appendAudit(client, {
        actor: input.actor, action: 'LOCATION_CREATED', entityType: 'LOCATION', entityId: location.locationId,
        tenantId: location.tenantId, locationId: location.locationId, commandId: input.commandId,
        after: location, now: input.now,
      });
      return location;
    });
  }

  async createProvisioningCode(input: {
    provisioningCodeId: string; locationId: string; codeHash: string; expiresAt: Date;
    commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<ProvisioningCodeRecord> {
    return this.transaction(async (client) => {
      await client.query(
        `UPDATE edge_provisioning_codes SET status = 'REVOKED', revoked_at = $2,
           revoked_by_admin_user_id = $3
         WHERE location_id = $1 AND status = 'ISSUED' AND expires_at <= $2`,
        [input.locationId, input.now, input.actor.userId],
      );
      const result = await client.query<{
        provisioning_code_id: string; tenant_id: string; location_id: string;
        status: 'ISSUED'; created_at: Date; expires_at: Date;
      }>(
        `INSERT INTO edge_provisioning_codes
           (provisioning_code_id, tenant_id, location_id, code_hash, status,
            created_by_admin_user_id, created_at, expires_at)
         SELECT $2, tenant_id, location_id, $3, 'ISSUED', $4, $5, $6
         FROM cloud_locations
         WHERE location_id = $1 AND status = 'ACTIVE' AND configuration_status = 'COMPLETE'
           AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.location_id = $1 AND e.status = 'ACTIVE')
         RETURNING provisioning_code_id, tenant_id, location_id, status, created_at, expires_at`,
        [input.locationId, input.provisioningCodeId, input.codeHash, input.actor.userId, input.now, input.expiresAt],
      );
      if (!result.rows[0]) throw new ControlPlaneConflictError('LOCATION_NOT_PROVISIONABLE');
      const code = mapCode(result.rows[0]);
      await appendAudit(client, {
        actor: input.actor, action: 'PROVISIONING_CODE_ISSUED', entityType: 'PROVISIONING_CODE',
        entityId: code.provisioningCodeId, tenantId: code.tenantId, locationId: code.locationId,
        commandId: input.commandId, after: code, now: input.now,
      });
      return code;
    });
  }

  async revokeProvisioningCode(input: {
    codeId: string; commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<ProvisioningCodeRecord> {
    return this.transaction(async (client) => {
      const existing = await client.query<CodeRow>(
        `SELECT provisioning_code_id, tenant_id, location_id, status, created_at, expires_at
         FROM edge_provisioning_codes WHERE provisioning_code_id = $1 FOR UPDATE`, [input.codeId],
      );
      const before = existing.rows[0];
      if (!before) throw new ControlPlaneNotFoundError();
      if (before.status === 'CONSUMED') throw new ControlPlaneConflictError('PROVISIONING_CODE_CONSUMED');
      await client.query(
        `UPDATE edge_provisioning_codes
         SET status = 'REVOKED', revoked_at = COALESCE(revoked_at,$2), revoked_by_admin_user_id = $3
         WHERE provisioning_code_id = $1`, [input.codeId, input.now, input.actor.userId],
      );
      const code = { ...mapCode(before), status: 'REVOKED' as const };
      await appendAudit(client, {
        actor: input.actor, action: 'PROVISIONING_CODE_REVOKED', entityType: 'PROVISIONING_CODE',
        entityId: code.provisioningCodeId, tenantId: code.tenantId, locationId: code.locationId,
        commandId: input.commandId, before: mapCode(before), after: code, now: input.now,
      });
      return code;
    });
  }

  async getProvisioningCode(codeId: string): Promise<ProvisioningCodeRecord | null> {
    const result = await this.pool.query<CodeRow>(
      `SELECT provisioning_code_id, tenant_id, location_id, status, created_at, expires_at
       FROM edge_provisioning_codes WHERE provisioning_code_id = $1`, [codeId],
    );
    return result.rows[0] ? mapCode(result.rows[0]) : null;
  }

  async getReplacement(replacementId: string): Promise<EdgeReplacementRecord | null> {
    const result = await this.pool.query<ReplacementJoinRow>(
      `${replacementSelect}
       WHERE r.replacement_id = $1`,
      [replacementId],
    );
    return result.rows[0] ? mapReplacement(result.rows[0]) : null;
  }

  async getPendingReplacement(locationId: string): Promise<EdgeReplacementRecord | null> {
    const result = await this.pool.query<ReplacementJoinRow>(
      `${replacementSelect}
       WHERE r.location_id = $1 AND r.status = 'PENDING'`,
      [locationId],
    );
    return result.rows[0] ? mapReplacement(result.rows[0]) : null;
  }

  async exchangeProvisioningCode(input: {
    attemptId: string; edgeId: string; credentialId: string; codeHash: string;
    credentialHash: string; now: Date;
  }): Promise<ProvisioningExchangeResult> {
    return this.transaction(async (client) => {
      const prior = await client.query<AttemptJoinRow>(
        `SELECT a.attempt_id, a.credential_id, a.credential_hash, c.code_hash,
                e.edge_id, e.tenant_id, e.location_id, e.status, e.provisioned_at,
                e.activated_at, e.revoked_at, e.replaced_at, e.replaced_by_edge_id,
                EXISTS(SELECT 1 FROM edge_replacements r
                       WHERE r.provisioning_code_id = c.provisioning_code_id) AS replacement
         FROM edge_provisioning_attempts a
         JOIN edge_provisioning_codes c ON c.provisioning_code_id = a.provisioning_code_id
         JOIN edges e ON e.edge_id = a.edge_id
         WHERE a.attempt_id = $1 FOR UPDATE OF a`, [input.attemptId],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (row.edge_id !== input.edgeId || row.credential_hash !== input.credentialHash || row.code_hash !== input.codeHash) {
          throw new ControlPlaneConflictError('PROVISIONING_ATTEMPT_MISMATCH');
        }
        await client.query('UPDATE edge_provisioning_attempts SET last_retry_at = $2 WHERE attempt_id = $1', [input.attemptId, input.now]);
        return { attemptId: row.attempt_id, credentialId: row.credential_id, edge: mapEdge(row), replacement: row.replacement };
      }

      const codeResult = await client.query<CodeSecretRow>(
        `SELECT c.provisioning_code_id, c.tenant_id, c.location_id, c.code_hash,
                c.status, c.created_at, c.expires_at,
                EXISTS(SELECT 1 FROM edge_replacements r
                       WHERE r.provisioning_code_id = c.provisioning_code_id AND r.status = 'PENDING') AS replacement
         FROM edge_provisioning_codes c WHERE c.code_hash = $1 FOR UPDATE`, [input.codeHash],
      );
      const code = codeResult.rows[0];
      if (!code || code.status !== 'ISSUED' || code.expires_at <= input.now) {
        throw new ControlPlaneInvalidCodeError();
      }
      if (!code.replacement) {
        const active = await client.query('SELECT 1 FROM edges WHERE location_id = $1 AND status = \'ACTIVE\'', [code.location_id]);
        if (active.rowCount) throw new ControlPlaneConflictError('LOCATION_ALREADY_HAS_ACTIVE_EDGE');
      }
      await client.query(
        `INSERT INTO edges
           (edge_id, tenant_id, location_id, credential_hash, status, created_at, updated_at,
            provisioned_at, provisioning_attempt_id)
         VALUES ($1,$2,$3,NULL,'PROVISIONING',$4,$4,$4,$5)`,
        [input.edgeId, code.tenant_id, code.location_id, input.now, input.attemptId],
      );
      await client.query(
        `INSERT INTO edge_credentials
           (credential_id, edge_id, credential_hash, status, issued_at)
         VALUES ($1,$2,$3,'PENDING',$4)`,
        [input.credentialId, input.edgeId, input.credentialHash, input.now],
      );
      await client.query(
        `INSERT INTO edge_provisioning_attempts
           (attempt_id, provisioning_code_id, edge_id, credential_id, credential_hash, status, exchanged_at)
         VALUES ($1,$2,$3,$4,$5,'EXCHANGED',$6)`,
        [input.attemptId, code.provisioning_code_id, input.edgeId, input.credentialId, input.credentialHash, input.now],
      );
      await client.query(
        `UPDATE edge_provisioning_codes
         SET status = 'CONSUMED', consumed_at = $2, consumed_by_edge_id = $3
         WHERE provisioning_code_id = $1`, [code.provisioning_code_id, input.now, input.edgeId],
      );
      if (code.replacement) {
        await client.query(
          `UPDATE edge_replacements SET new_edge_id = $2
           WHERE provisioning_code_id = $1 AND status = 'PENDING'`,
          [code.provisioning_code_id, input.edgeId],
        );
      }
      const edge: ProvisionedEdgeRecord = {
        edgeId: input.edgeId, tenantId: code.tenant_id, locationId: code.location_id,
        status: 'PROVISIONING', provisionedAt: input.now, activatedAt: null,
        revokedAt: null, replacedAt: null, replacedByEdgeId: null,
      };
      await appendAudit(client, {
        actor: null, action: 'EDGE_PROVISIONING_EXCHANGED', entityType: 'EDGE', entityId: input.edgeId,
        tenantId: code.tenant_id, locationId: code.location_id, edgeId: input.edgeId,
        commandId: input.attemptId, after: edge, now: input.now,
      });
      return { attemptId: input.attemptId, credentialId: input.credentialId, edge, replacement: code.replacement };
    });
  }

  async getProvisioningCredential(edgeId: string, credentialHash: string): Promise<{ attemptId: string; credentialId: string } | null> {
    const result = await this.pool.query<{ attempt_id: string; credential_id: string }>(
      `SELECT a.attempt_id, c.credential_id
       FROM edge_provisioning_attempts a
       JOIN edge_credentials c ON c.credential_id = a.credential_id
       JOIN edges e ON e.edge_id = a.edge_id
       WHERE a.edge_id = $1 AND c.credential_hash = $2 AND c.status IN ('PENDING','ACTIVE')
         AND e.status IN ('PROVISIONING','ACTIVE')`, [edgeId, credentialHash],
    );
    return result.rows[0] ? { attemptId: result.rows[0].attempt_id, credentialId: result.rows[0].credential_id } : null;
  }

  async activateProvisionedEdge(input: {
    edgeId: string; attemptId: string; credentialId: string; commandId: string; now: Date;
  }): Promise<ProvisionedEdgeRecord> {
    return this.transaction(async (client) => {
      const identity = await client.query<Pick<EdgeRow, 'location_id'>>(
        'SELECT location_id FROM edges WHERE edge_id = $1', [input.edgeId],
      );
      if (!identity.rows[0]) throw new ControlPlaneNotFoundError();
      await client.query('SELECT location_id FROM cloud_locations WHERE location_id = $1 FOR UPDATE', [identity.rows[0].location_id]);
      const edgeResult = await client.query<EdgeRow>(
        `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
                revoked_at, replaced_at, replaced_by_edge_id
         FROM edges WHERE edge_id = $1 FOR UPDATE`, [input.edgeId],
      );
      const edge = edgeResult.rows[0];
      if (!edge) throw new ControlPlaneNotFoundError();
      if (edge.status === 'ACTIVE') return mapEdge(edge);
      if (edge.status !== 'PROVISIONING') throw new ControlPlaneConflictError('EDGE_NOT_PROVISIONING');
      const replacement = await client.query<{ replacement_id: string; old_edge_id: string }>(
        `SELECT replacement_id, old_edge_id FROM edge_replacements
         WHERE new_edge_id = $1 AND status = 'PENDING' FOR UPDATE`, [input.edgeId],
      );
      if (replacement.rows[0]) {
        const oldEdge = await client.query<{ status: string }>(
          'SELECT status FROM edges WHERE edge_id = $1 FOR UPDATE',
          [replacement.rows[0].old_edge_id],
        );
        if (oldEdge.rows[0]?.status !== 'ACTIVE') {
          throw new ControlPlaneConflictError('EDGE_REPLACEMENT_OLD_EDGE_NOT_ACTIVE');
        }
        const replaced = await client.query(
          `UPDATE edges SET status = 'REPLACED', replaced_at = $2,
             replaced_by_edge_id = $3, updated_at = $2
           WHERE edge_id = $1 AND status = 'ACTIVE'`,
          [replacement.rows[0].old_edge_id, input.now, input.edgeId],
        );
        if (replaced.rowCount !== 1) {
          throw new ControlPlaneConflictError('EDGE_REPLACEMENT_OLD_EDGE_NOT_ACTIVE');
        }
        await client.query(
          `UPDATE edge_credentials SET status = 'REVOKED', revoked_at = $2
           WHERE edge_id = $1 AND status IN ('ACTIVE','RETIRING')`,
          [replacement.rows[0].old_edge_id, input.now],
        );
        await client.query(
          `UPDATE edge_replacements SET status = 'COMPLETED', completed_at = $2
           WHERE replacement_id = $1`, [replacement.rows[0].replacement_id, input.now],
        );
      } else {
        const active = await client.query(
          `SELECT 1 FROM edges WHERE location_id = $1 AND status = 'ACTIVE' AND edge_id <> $2`,
          [edge.location_id, input.edgeId],
        );
        if (active.rowCount) throw new ControlPlaneConflictError('LOCATION_ALREADY_HAS_ACTIVE_EDGE');
      }
      await client.query(
        `UPDATE edge_credentials SET status = 'ACTIVE', activated_at = $3
         WHERE credential_id = $1 AND edge_id = $2 AND status = 'PENDING'`,
        [input.credentialId, input.edgeId, input.now],
      );
      await client.query(
        `UPDATE edge_provisioning_attempts SET status = 'ACTIVATED', activated_at = $3
         WHERE attempt_id = $1 AND edge_id = $2`, [input.attemptId, input.edgeId, input.now],
      );
      await client.query(
        `UPDATE edges SET status = 'ACTIVE', activated_at = $2, updated_at = $2
         WHERE edge_id = $1`, [input.edgeId, input.now],
      );
      const activated = { ...mapEdge(edge), status: 'ACTIVE' as const, activatedAt: input.now };
      await appendAudit(client, {
        actor: null, action: replacement.rows[0] ? 'EDGE_REPLACEMENT_COMPLETED' : 'EDGE_ACTIVATED',
        entityType: 'EDGE', entityId: input.edgeId, tenantId: edge.tenant_id,
        locationId: edge.location_id, edgeId: input.edgeId, commandId: input.commandId,
        before: mapEdge(edge), after: activated, now: input.now,
      });
      return activated;
    });
  }

  async revokeEdge(input: {
    edgeId: string; reason: string; commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<ProvisionedEdgeRecord> {
    return this.transaction(async (client) => {
      const identity = await client.query<Pick<EdgeRow, 'location_id'>>(
        'SELECT location_id FROM edges WHERE edge_id = $1', [input.edgeId],
      );
      if (!identity.rows[0]) throw new ControlPlaneNotFoundError();
      await client.query('SELECT location_id FROM cloud_locations WHERE location_id = $1 FOR UPDATE', [identity.rows[0].location_id]);
      const result = await client.query<EdgeRow>(
        `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
                revoked_at, replaced_at, replaced_by_edge_id
         FROM edges WHERE edge_id = $1 FOR UPDATE`, [input.edgeId],
      );
      const row = result.rows[0];
      if (!row) throw new ControlPlaneNotFoundError();
      if (row.status === 'REPLACED') throw new ControlPlaneConflictError('EDGE_ALREADY_REPLACED');
      const pendingReplacement = await client.query(
        `SELECT 1 FROM edge_replacements
         WHERE old_edge_id = $1 AND status = 'PENDING'`,
        [input.edgeId],
      );
      if (pendingReplacement.rowCount) {
        throw new ControlPlaneConflictError('EDGE_REPLACEMENT_PENDING');
      }
      await client.query(
        `UPDATE edges SET status = 'REVOKED', revoked_at = COALESCE(revoked_at,$2), updated_at = $2
         WHERE edge_id = $1`, [input.edgeId, input.now],
      );
      await client.query(
        `UPDATE edge_credentials SET status = 'REVOKED', revoked_at = COALESCE(revoked_at,$2)
         WHERE edge_id = $1 AND status <> 'REVOKED'`, [input.edgeId, input.now],
      );
      const edge = { ...mapEdge(row), status: 'REVOKED' as const, revokedAt: row.revoked_at ?? input.now };
      await appendAudit(client, {
        actor: input.actor, action: 'EDGE_REVOKED', entityType: 'EDGE', entityId: input.edgeId,
        tenantId: row.tenant_id, locationId: row.location_id, edgeId: input.edgeId,
        commandId: input.commandId, reason: input.reason, before: mapEdge(row), after: edge, now: input.now,
      });
      return edge;
    });
  }

  async initiateReplacement(input: {
    replacementId: string; oldEdgeId: string; provisioningCodeId: string; codeHash: string;
    expiresAt: Date; reason: string; commandId: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<{ replacementId: string; code: ProvisioningCodeRecord }> {
    return this.transaction(async (client) => {
      const oldResult = await client.query<EdgeRow>(
        `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
                revoked_at, replaced_at, replaced_by_edge_id
         FROM edges WHERE edge_id = $1 FOR UPDATE`, [input.oldEdgeId],
      );
      const old = oldResult.rows[0];
      if (!old || old.status !== 'ACTIVE') throw new ControlPlaneConflictError('EDGE_NOT_ACTIVE');
      const codeResult = await client.query<CodeRow>(
        `INSERT INTO edge_provisioning_codes
           (provisioning_code_id, tenant_id, location_id, code_hash, status,
            created_by_admin_user_id, created_at, expires_at)
         VALUES ($1,$2,$3,$4,'ISSUED',$5,$6,$7)
         RETURNING provisioning_code_id, tenant_id, location_id, status, created_at, expires_at`,
        [input.provisioningCodeId, old.tenant_id, old.location_id, input.codeHash, input.actor.userId, input.now, input.expiresAt],
      );
      await client.query(
        `INSERT INTO edge_replacements
           (replacement_id, tenant_id, location_id, old_edge_id, provisioning_code_id,
            status, reason, initiated_by_admin_user_id, initiated_at)
         VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8)`,
        [input.replacementId, old.tenant_id, old.location_id, old.edge_id,
          input.provisioningCodeId, input.reason, input.actor.userId, input.now],
      );
      const code = mapCode(codeResult.rows[0]!);
      await appendAudit(client, {
        actor: input.actor, action: 'EDGE_REPLACEMENT_INITIATED', entityType: 'EDGE_REPLACEMENT',
        entityId: input.replacementId, tenantId: old.tenant_id, locationId: old.location_id,
        edgeId: old.edge_id, commandId: input.commandId, reason: input.reason,
        after: { replacementId: input.replacementId, oldEdgeId: old.edge_id, status: 'PENDING', codeId: code.provisioningCodeId },
        now: input.now,
      });
      return { replacementId: input.replacementId, code };
    });
  }

  async cancelReplacement(input: {
    replacementId: string; reason: string; commandId: string;
    actor: CloudAdminMutationActor; now: Date;
  }): Promise<EdgeReplacementRecord> {
    return this.transaction(async (client) => {
      const identity = await client.query<{ provisioning_code_id: string }>(
        'SELECT provisioning_code_id FROM edge_replacements WHERE replacement_id = $1',
        [input.replacementId],
      );
      if (!identity.rows[0]) throw new ControlPlaneNotFoundError();

      await client.query(
        'SELECT provisioning_code_id FROM edge_provisioning_codes WHERE provisioning_code_id = $1 FOR UPDATE',
        [identity.rows[0].provisioning_code_id],
      );
      const current = await client.query<ReplacementJoinRow>(
        `${replacementSelect}
         WHERE r.replacement_id = $1
         FOR UPDATE OF r`,
        [input.replacementId],
      );
      const before = current.rows[0];
      if (!before) throw new ControlPlaneNotFoundError();
      if (before.replacement_status !== 'PENDING') {
        throw new ControlPlaneConflictError('EDGE_REPLACEMENT_NOT_PENDING');
      }
      if (before.new_edge_id) {
        throw new ControlPlaneConflictError('EDGE_REPLACEMENT_ALREADY_EXCHANGED');
      }

      await client.query(
        `UPDATE edge_provisioning_codes
         SET status = 'REVOKED', revoked_at = COALESCE(revoked_at,$2),
             revoked_by_admin_user_id = COALESCE(revoked_by_admin_user_id,$3)
         WHERE provisioning_code_id = $1 AND status = 'ISSUED'`,
        [before.provisioning_code_id, input.now, input.actor.userId],
      );
      await client.query(
        `UPDATE edge_replacements
         SET status = 'CANCELLED', cancelled_at = $2
         WHERE replacement_id = $1`,
        [input.replacementId, input.now],
      );

      const cancelled: EdgeReplacementRecord = {
        ...mapReplacement(before),
        status: 'CANCELLED',
        cancelledAt: input.now,
        provisioningCode: {
          ...mapCode(before),
          status: before.code_status === 'ISSUED' ? 'REVOKED' : before.code_status,
        },
      };
      await appendAudit(client, {
        actor: input.actor, action: 'EDGE_REPLACEMENT_CANCELLED',
        entityType: 'EDGE_REPLACEMENT', entityId: input.replacementId,
        tenantId: before.tenant_id, locationId: before.location_id,
        edgeId: before.old_edge_id, commandId: input.commandId, reason: input.reason,
        before: mapReplacement(before), after: cancelled, now: input.now,
      });
      return cancelled;
    });
  }

  async registerRotation(input: {
    rotationId: string; credentialId: string; edgeId: string; credentialHash: string; now: Date;
  }): Promise<{ rotationId: string; credentialId: string; status: string }> {
    return this.transaction(async (client) => {
      const prior = await client.query<{ credential_id: string; credential_hash: string; status: string }>(
        'SELECT credential_id, credential_hash, status FROM edge_credentials WHERE rotation_id = $1 FOR UPDATE',
        [input.rotationId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].credential_hash !== input.credentialHash || prior.rows[0].credential_id !== input.credentialId) {
          throw new ControlPlaneConflictError('ROTATION_ID_MISMATCH');
        }
        return { rotationId: input.rotationId, credentialId: prior.rows[0].credential_id, status: prior.rows[0].status };
      }
      await client.query(
        `INSERT INTO edge_credentials
           (credential_id, edge_id, credential_hash, status, rotation_id, issued_at)
         VALUES ($1,$2,$3,'PENDING',$4,$5)`,
        [input.credentialId, input.edgeId, input.credentialHash, input.rotationId, input.now],
      );
      const edge = await client.query<EdgeRow>(
        `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
                revoked_at, replaced_at, replaced_by_edge_id
         FROM edges WHERE edge_id = $1`, [input.edgeId],
      );
      const row = edge.rows[0];
      if (!row || row.status !== 'ACTIVE') throw new ControlPlaneConflictError('EDGE_NOT_ACTIVE');
      await appendAudit(client, {
        actor: null, action: 'EDGE_CREDENTIAL_ROTATION_REGISTERED', entityType: 'EDGE_CREDENTIAL',
        entityId: input.credentialId, tenantId: row.tenant_id, locationId: row.location_id,
        edgeId: input.edgeId, commandId: input.rotationId,
        after: { rotationId: input.rotationId, credentialId: input.credentialId, status: 'PENDING' },
        now: input.now,
      });
      return { rotationId: input.rotationId, credentialId: input.credentialId, status: 'PENDING' };
    });
  }

  async getPendingRotationCredential(edgeId: string, rotationId: string, credentialHash: string): Promise<{ credentialId: string } | null> {
    const result = await this.pool.query<{ credential_id: string }>(
      `SELECT credential_id FROM edge_credentials
       WHERE edge_id = $1 AND rotation_id = $2 AND credential_hash = $3 AND status IN ('PENDING','ACTIVE')`,
      [edgeId, rotationId, credentialHash],
    );
    return result.rows[0] ? { credentialId: result.rows[0].credential_id } : null;
  }

  async confirmRotation(input: {
    edgeId: string; rotationId: string; credentialId: string; commandId: string;
    overlapMs: number; now: Date;
  }): Promise<{ rotationId: string; credentialId: string; status: 'ACTIVE'; previousRetiresAt: Date | null }> {
    return this.transaction(async (client) => {
      const pending = await client.query<{ status: string }>(
        `SELECT status FROM edge_credentials WHERE credential_id = $1 AND edge_id = $2 AND rotation_id = $3 FOR UPDATE`,
        [input.credentialId, input.edgeId, input.rotationId],
      );
      if (!pending.rows[0]) throw new ControlPlaneNotFoundError();
      if (pending.rows[0].status === 'ACTIVE') {
        const retiring = await client.query<{ retire_after: Date }>(
          `SELECT retire_after FROM edge_credentials WHERE edge_id = $1 AND status = 'RETIRING' ORDER BY retire_after DESC LIMIT 1`,
          [input.edgeId],
        );
        return { rotationId: input.rotationId, credentialId: input.credentialId, status: 'ACTIVE', previousRetiresAt: retiring.rows[0]?.retire_after ?? null };
      }
      if (pending.rows[0].status !== 'PENDING') throw new ControlPlaneConflictError('ROTATION_NOT_PENDING');
      const retireAt = new Date(input.now.getTime() + input.overlapMs);
      await client.query(
        `UPDATE edge_credentials SET status = 'RETIRING', retire_after = $2
         WHERE edge_id = $1 AND status = 'ACTIVE'`, [input.edgeId, retireAt],
      );
      await client.query(
        `UPDATE edge_credentials SET status = 'ACTIVE', activated_at = $2
         WHERE credential_id = $1`, [input.credentialId, input.now],
      );
      const edge = await client.query<EdgeRow>(
        `SELECT edge_id, tenant_id, location_id, status, provisioned_at, activated_at,
                revoked_at, replaced_at, replaced_by_edge_id
         FROM edges WHERE edge_id = $1`, [input.edgeId],
      );
      const row = edge.rows[0];
      if (!row) throw new ControlPlaneNotFoundError();
      await appendAudit(client, {
        actor: null, action: 'EDGE_CREDENTIAL_ROTATION_CONFIRMED', entityType: 'EDGE_CREDENTIAL',
        entityId: input.credentialId, tenantId: row.tenant_id, locationId: row.location_id,
        edgeId: input.edgeId, commandId: input.commandId,
        after: { rotationId: input.rotationId, credentialId: input.credentialId,
          status: 'ACTIVE', previousRetiresAt: retireAt.toISOString() }, now: input.now,
      });
      return { rotationId: input.rotationId, credentialId: input.credentialId, status: 'ACTIVE', previousRetiresAt: retireAt };
    });
  }

  async retireExpiredCredentials(now: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE edge_credentials SET status = 'REVOKED', revoked_at = $1
       WHERE status = 'RETIRING' AND retire_after <= $1`, [now],
    );
    return result.rowCount ?? 0;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class ControlPlaneConflictError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ControlPlaneConflictError'; }
}
export class ControlPlaneNotFoundError extends Error {}
export class ControlPlaneInvalidCodeError extends Error {}

interface EdgeRow {
  edge_id: string; tenant_id: string; location_id: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'REVOKED' | 'REPLACED';
  provisioned_at: Date | null; activated_at: Date | null; revoked_at: Date | null;
  replaced_at: Date | null; replaced_by_edge_id: string | null;
}
interface CodeRow {
  provisioning_code_id: string; tenant_id: string; location_id: string;
  status: 'ISSUED' | 'CONSUMED' | 'REVOKED'; created_at: Date; expires_at: Date;
}
interface CodeSecretRow extends CodeRow { code_hash: string; replacement: boolean }
interface AttemptJoinRow extends EdgeRow {
  attempt_id: string; credential_id: string; credential_hash: string; code_hash: string; replacement: boolean;
}
interface ReplacementJoinRow extends CodeRow {
  replacement_id: string;
  old_edge_id: string;
  new_edge_id: string | null;
  replacement_status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  reason: string;
  initiated_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  code_status: 'ISSUED' | 'CONSUMED' | 'REVOKED';
}

const replacementSelect = `SELECT r.replacement_id, r.tenant_id, r.location_id,
       r.old_edge_id, r.new_edge_id, r.status AS replacement_status, r.reason,
       r.initiated_at, r.completed_at, r.cancelled_at,
       c.provisioning_code_id, c.status AS code_status, c.status,
       c.created_at, c.expires_at
FROM edge_replacements r
JOIN edge_provisioning_codes c ON c.provisioning_code_id = r.provisioning_code_id`;

function mapEdge(row: EdgeRow): ProvisionedEdgeRecord {
  return {
    edgeId: row.edge_id, tenantId: row.tenant_id, locationId: row.location_id, status: row.status,
    provisionedAt: row.provisioned_at, activatedAt: row.activated_at, revokedAt: row.revoked_at,
    replacedAt: row.replaced_at, replacedByEdgeId: row.replaced_by_edge_id,
  };
}
function mapLocation(row: {
  tenant_id: string; location_id: string; display_name: string | null; timezone: string | null;
  status: 'ACTIVE' | 'INACTIVE'; configuration_status: 'COMPLETE' | 'PENDING_CONFIGURATION'; created_at: Date;
}): CanonicalLocationRecord {
  return {
    tenantId: row.tenant_id, locationId: row.location_id, displayName: row.display_name,
    timezone: row.timezone, status: row.status, configurationStatus: row.configuration_status,
    createdAt: row.created_at,
  };
}
function mapCode(row: CodeRow): ProvisioningCodeRecord {
  return {
    provisioningCodeId: row.provisioning_code_id, tenantId: row.tenant_id, locationId: row.location_id,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
  };
}
function mapReplacement(row: ReplacementJoinRow): EdgeReplacementRecord {
  return {
    replacementId: row.replacement_id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    oldEdgeId: row.old_edge_id,
    newEdgeId: row.new_edge_id,
    status: row.replacement_status,
    reason: row.reason,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    provisioningCode: {
      provisioningCodeId: row.provisioning_code_id,
      tenantId: row.tenant_id,
      locationId: row.location_id,
      status: row.code_status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    },
  };
}

export async function appendCloudAdminAudit(client: PoolClient, input: {
  actor: CloudAdminMutationActor | null; action: string; entityType: string; entityId: string;
  tenantId?: string; locationId?: string; edgeId?: string; commandId: string; reason?: string;
  before?: unknown; after?: unknown; now: Date; allowExistingCommand?: boolean;
}): Promise<void> {
  if (input.allowExistingCommand) {
    const existing = await client.query('SELECT 1 FROM cloud_admin_audit_log WHERE command_id = $1', [input.commandId]);
    if (existing.rowCount) return;
  }
  const scopeKey = input.tenantId ? `TENANT:${input.tenantId}` : 'PLATFORM';
  await client.query(
    `INSERT INTO cloud_admin_audit_chain_heads(scope_key,last_hash,updated_at)
     VALUES ($1,NULL,$2) ON CONFLICT (scope_key) DO NOTHING`, [scopeKey, input.now],
  );
  const head = await client.query<{ last_hash: string | null }>(
    'SELECT last_hash FROM cloud_admin_audit_chain_heads WHERE scope_key = $1 FOR UPDATE', [scopeKey],
  );
  const previousHash = head.rows[0]?.last_hash ?? null;
  const material = canonicalJson({
    scopeKey, actorUserId: input.actor?.userId ?? null, sessionId: input.actor?.sessionId ?? null,
    action: input.action, entityType: input.entityType, entityId: input.entityId,
    tenantId: input.tenantId ?? null, locationId: input.locationId ?? null, edgeId: input.edgeId ?? null,
    commandId: input.commandId, reason: input.reason ?? null, before: input.before ?? null,
    after: input.after ?? null, occurredAt: input.now.toISOString(), previousHash,
  });
  const entryHash = createHash('sha256').update(material).digest('hex');
  await client.query(
    `INSERT INTO cloud_admin_audit_log
       (audit_id,scope_key,actor_admin_user_id,session_id,action,entity_type,entity_id,
        tenant_id,location_id,edge_id,command_id,reason,before_state,after_state,occurred_at,
        previous_hash,entry_hash)
     VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [scopeKey, input.actor?.userId ?? null, input.actor?.sessionId ?? null, input.action,
      input.entityType, input.entityId, input.tenantId ?? null, input.locationId ?? null,
      input.edgeId ?? null, input.commandId, input.reason ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after), input.now, previousHash, entryHash],
  );
  await client.query(
    'UPDATE cloud_admin_audit_chain_heads SET last_hash = $2, updated_at = $3 WHERE scope_key = $1',
    [scopeKey, entryHash, input.now],
  );
}

const appendAudit = appendCloudAdminAudit;

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
