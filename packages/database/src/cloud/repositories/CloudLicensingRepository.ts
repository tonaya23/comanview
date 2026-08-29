import type { Pool, PoolClient } from 'pg';
import type {
  CapabilityCode,
  EdgeConfiguration,
  LicenseDeclaredState,
  SignedDocumentEnvelope,
} from '@comanview/contracts';
import { appendCloudAdminAudit, type CloudAdminMutationActor } from './CloudControlPlaneRepository.js';

export interface CloudPlanRecord {
  planId: string;
  code: string;
  displayName: string;
  active: boolean;
  capabilities: CapabilityCode[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocationLicenseRecord {
  tenantId: string;
  locationId: string;
  planId: string;
  planCode: string;
  declaredState: LicenseDeclaredState;
  revision: number;
  capabilities: CapabilityCode[];
  configuration: EdgeConfiguration;
  configurationRevision: number;
  featureFlags: Record<string, boolean>;
  featureFlagsRevision: number;
  desiredControlRevision: number;
  activeEdgeId: string | null;
  updatedAt: Date;
}

export interface SignedControlDocumentRecord {
  documentId: string;
  documentType: 'LICENSE' | 'FEATURE_FLAGS' | 'CONFIGURATION';
  revision: number;
  kid: string;
  documentHash: string;
  envelope: SignedDocumentEnvelope;
  issuedAt: Date;
  expiresAt: Date | null;
  graceUntil: Date | null;
}

export interface NewSignedControlDocument extends SignedControlDocumentRecord {
  tenantId: string;
  locationId: string;
  edgeId: string;
}

export class CloudLicensingRepository {
  constructor(private readonly pool: Pool) {}

  async findIdempotentResult(commandId: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query<{ after_state: Record<string, unknown> | null }>(
      'SELECT after_state FROM cloud_admin_audit_log WHERE command_id = $1', [commandId],
    );
    return result.rows[0]?.after_state ?? null;
  }

  async listPlans(): Promise<CloudPlanRecord[]> {
    const plans = await this.pool.query<PlanRow>(
      `SELECT plan_id, code, display_name, active, revision, created_at, updated_at
       FROM cloud_plans ORDER BY code`,
    );
    return Promise.all(plans.rows.map((row) => this.mapPlan(row)));
  }

  async getPlan(planId: string): Promise<CloudPlanRecord | null> {
    const result = await this.pool.query<PlanRow>(
      `SELECT plan_id, code, display_name, active, revision, created_at, updated_at
       FROM cloud_plans WHERE plan_id = $1`, [planId],
    );
    return result.rows[0] ? this.mapPlan(result.rows[0]) : null;
  }

  async createPlan(input: {
    planId: string; code: string; displayName: string; capabilities: CapabilityCode[];
    commandId: string; reason: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<CloudPlanRecord> {
    return this.transaction(async (client) => {
      const row = (await client.query<PlanRow>(
        `INSERT INTO cloud_plans(plan_id,code,display_name,active,revision,created_at,updated_at)
         VALUES($1,$2,$3,TRUE,1,$4,$4)
         RETURNING plan_id,code,display_name,active,revision,created_at,updated_at`,
        [input.planId, input.code, input.displayName, input.now],
      )).rows[0]!;
      for (const capability of [...new Set(input.capabilities)].sort()) {
        await client.query(
          `INSERT INTO cloud_plan_entitlements(plan_id,capability,created_at) VALUES($1,$2,$3)`,
          [input.planId, capability, input.now],
        );
      }
      const plan = { ...mapPlanRow(row), capabilities: [...new Set(input.capabilities)].sort() as CapabilityCode[] };
      await appendCloudAdminAudit(client, {
        actor: input.actor, action: 'PLAN_CREATED', entityType: 'PLAN', entityId: input.planId,
        commandId: input.commandId, reason: input.reason, after: plan, now: input.now,
      });
      return plan;
    });
  }

  async getLocationAssignment(locationId: string): Promise<LocationLicenseRecord | null> {
    const result = await this.pool.query<AssignmentRow>(assignmentSql, [locationId]);
    return result.rows[0] ? mapAssignment(result.rows[0]) : null;
  }

  async getAssignmentContext(locationId: string, planId: string): Promise<{
    tenantId: string; locationId: string; plan: CloudPlanRecord; activeEdgeId: string | null;
  } | null> {
    const result = await this.pool.query<{ tenant_id: string; location_id: string; edge_id: string | null }>(
      `SELECT l.tenant_id,l.location_id,e.edge_id
       FROM cloud_locations l
       LEFT JOIN edges e ON e.location_id=l.location_id AND e.status='ACTIVE'
       WHERE l.location_id=$1 AND l.status='ACTIVE'`, [locationId],
    );
    const plan = await this.getPlan(planId);
    const row = result.rows[0];
    return row && plan?.active ? {
      tenantId: row.tenant_id, locationId: row.location_id, plan, activeEdgeId: row.edge_id,
    } : null;
  }

  async assignLocation(input: {
    tenantId: string; locationId: string; plan: CloudPlanRecord; declaredState: LicenseDeclaredState;
    configuration: EdgeConfiguration; documents: NewSignedControlDocument[];
    expectedRevision: number;
    commandId: string; reason: string; actor: CloudAdminMutationActor; now: Date;
  }): Promise<LocationLicenseRecord> {
    return this.transaction(async (client) => {
      const locked = await client.query<{ revision: number }>(
        'SELECT revision FROM cloud_location_license_state WHERE location_id=$1 FOR UPDATE',
        [input.locationId],
      );
      const currentRevision = locked.rows[0]?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new LicensingConflictError('LICENSE_REVISION_CONFLICT');
      }
      await client.query(
        `INSERT INTO cloud_location_license_state
          (location_id,tenant_id,plan_id,declared_state,revision,updated_by_admin_user_id,updated_at)
         VALUES($1,$2,$3,$4,1,$5,$6)
         ON CONFLICT(location_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,
           declared_state=EXCLUDED.declared_state, revision=cloud_location_license_state.revision+1,
           updated_by_admin_user_id=EXCLUDED.updated_by_admin_user_id,updated_at=EXCLUDED.updated_at`,
        [input.locationId,input.tenantId,input.plan.planId,input.declaredState,input.actor.userId,input.now],
      );
      await client.query(
        `INSERT INTO cloud_location_configuration_state
          (location_id,tenant_id,revision,configuration,updated_by_admin_user_id,updated_at)
         VALUES($1,$2,1,$3,$4,$5)
         ON CONFLICT(location_id) DO UPDATE SET revision=cloud_location_configuration_state.revision+1,
           configuration=EXCLUDED.configuration,updated_by_admin_user_id=EXCLUDED.updated_by_admin_user_id,
           updated_at=EXCLUDED.updated_at`,
        [input.locationId,input.tenantId,JSON.stringify(input.configuration),input.actor.userId,input.now],
      );
      await client.query(
        `INSERT INTO cloud_location_feature_flag_state
          (location_id,tenant_id,revision,flags,updated_by_admin_user_id,updated_at)
         VALUES($1,$2,1,'{}'::jsonb,$3,$4)
         ON CONFLICT(location_id) DO NOTHING`,
        [input.locationId,input.tenantId,input.actor.userId,input.now],
      );
      await client.query(
        `INSERT INTO cloud_location_control_state(location_id,tenant_id,desired_control_revision,updated_at)
         VALUES($1,$2,1,$3)
         ON CONFLICT(location_id) DO UPDATE SET
           desired_control_revision=cloud_location_control_state.desired_control_revision+1,
           updated_at=EXCLUDED.updated_at`, [input.locationId,input.tenantId,input.now],
      );
      await this.insertDocuments(client, input.documents, input.now);
      const assignment = (await client.query<AssignmentRow>(assignmentSql, [input.locationId])).rows[0]!;
      const mapped = mapAssignment(assignment);
      await appendCloudAdminAudit(client, {
        actor: input.actor, action: 'LOCATION_LICENSE_ASSIGNED', entityType: 'LOCATION_LICENSE',
        entityId: input.locationId, tenantId: input.tenantId, locationId: input.locationId,
        commandId: input.commandId, reason: input.reason, after: mapped, now: input.now,
      });
      return mapped;
    });
  }

  async updateLicenseState(input: {
    locationId: string; expectedRevision: number; declaredState: LicenseDeclaredState;
    document: NewSignedControlDocument | null; commandId: string; reason: string;
    actor: CloudAdminMutationActor; now: Date;
  }): Promise<LocationLicenseRecord> {
    return this.transaction(async (client) => {
      const before = (await client.query<AssignmentRow>(assignmentSql + ' FOR UPDATE OF ls', [input.locationId])).rows[0];
      if (!before) throw new LicensingConflictError('LOCATION_LICENSE_NOT_ASSIGNED');
      const changed = await client.query(
        `UPDATE cloud_location_license_state SET declared_state=$3,revision=revision+1,
           updated_by_admin_user_id=$4,updated_at=$5 WHERE location_id=$1 AND revision=$2`,
        [input.locationId,input.expectedRevision,input.declaredState,input.actor.userId,input.now],
      );
      if (changed.rowCount !== 1) throw new LicensingConflictError('LICENSE_REVISION_CONFLICT');
      await client.query(
        `UPDATE cloud_location_control_state SET desired_control_revision=desired_control_revision+1,
           updated_at=$2 WHERE location_id=$1`, [input.locationId,input.now],
      );
      if (input.document) await this.insertDocuments(client, [input.document], input.now);
      const after = mapAssignment((await client.query<AssignmentRow>(assignmentSql, [input.locationId])).rows[0]!);
      await appendCloudAdminAudit(client, {
        actor: input.actor, action: 'LOCATION_LICENSE_STATE_CHANGED', entityType: 'LOCATION_LICENSE',
        entityId: input.locationId, tenantId: after.tenantId, locationId: input.locationId,
        commandId: input.commandId, reason: input.reason, before: mapAssignment(before), after, now: input.now,
      });
      return after;
    });
  }

  async updateConfiguration(input: {
    locationId: string; expectedRevision: number; configuration: EdgeConfiguration;
    document: NewSignedControlDocument | null; commandId: string; reason: string;
    actor: CloudAdminMutationActor; now: Date;
  }): Promise<LocationLicenseRecord> {
    return this.transaction(async (client) => {
      const changed = await client.query(
        `UPDATE cloud_location_configuration_state SET configuration=$3,revision=revision+1,
           updated_by_admin_user_id=$4,updated_at=$5 WHERE location_id=$1 AND revision=$2`,
        [input.locationId,input.expectedRevision,JSON.stringify(input.configuration),input.actor.userId,input.now],
      );
      if (changed.rowCount !== 1) throw new LicensingConflictError('CONFIGURATION_REVISION_CONFLICT');
      await client.query(
        `UPDATE cloud_location_control_state SET desired_control_revision=desired_control_revision+1,
           updated_at=$2 WHERE location_id=$1`, [input.locationId,input.now],
      );
      if (input.document) await this.insertDocuments(client, [input.document], input.now);
      const after = mapAssignment((await client.query<AssignmentRow>(assignmentSql, [input.locationId])).rows[0]!);
      await appendCloudAdminAudit(client, {
        actor: input.actor, action: 'LOCATION_CONFIGURATION_CHANGED', entityType: 'LOCATION_CONFIGURATION',
        entityId: input.locationId, tenantId: after.tenantId, locationId: input.locationId,
        commandId: input.commandId, reason: input.reason, after, now: input.now,
      });
      return after;
    });
  }

  async currentDocuments(edgeId: string): Promise<{
    assignment: LocationLicenseRecord; documents: SignedControlDocumentRecord[];
  } | null> {
    const edge = await this.pool.query<{ location_id: string }>(
      `SELECT location_id FROM edges WHERE edge_id=$1 AND status='ACTIVE'`, [edgeId],
    );
    if (!edge.rows[0]) return null;
    const assignment = await this.getLocationAssignment(edge.rows[0].location_id);
    if (!assignment) return null;
    const docs = await this.pool.query<DocumentRow>(
      `SELECT DISTINCT ON (document_type) document_id,document_type,revision,kid,document_hash,
         envelope,issued_at,expires_at,grace_until
       FROM cloud_signed_control_documents WHERE edge_id=$1
       ORDER BY document_type,revision DESC`, [edgeId],
    );
    return { assignment, documents: docs.rows.map(mapDocument) };
  }

  async storeDocuments(documents: NewSignedControlDocument[], now: Date): Promise<void> {
    await this.transaction((client) => this.insertDocuments(client, documents, now));
  }

  async acknowledge(input: {
    edgeId: string; documentType: string; revision: number; documentHash: string;
    appliedAt: Date; receivedAt: Date; commandId: string;
  }): Promise<void> {
    const document = await this.pool.query(
      `SELECT 1 FROM cloud_signed_control_documents
       WHERE edge_id=$1 AND document_type=$2 AND revision=$3 AND document_hash=$4`,
      [input.edgeId,input.documentType,input.revision,input.documentHash],
    );
    if (document.rowCount !== 1) throw new LicensingConflictError('CONTROL_ACK_DOCUMENT_MISMATCH');
    await this.pool.query(
      `INSERT INTO cloud_edge_control_state_acks
        (edge_id,document_type,revision,document_hash,applied_at,received_at,command_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [input.edgeId,input.documentType,input.revision,input.documentHash,input.appliedAt,input.receivedAt,input.commandId],
    );
    const command = await this.pool.query<{
      edge_id: string; document_type: string; revision: number; document_hash: string;
    }>(`SELECT edge_id,document_type,revision,document_hash
        FROM cloud_edge_control_state_acks WHERE command_id=$1`, [input.commandId]);
    const existing = command.rows[0];
    if (existing && (existing.edge_id !== input.edgeId || existing.document_type !== input.documentType ||
      existing.revision !== input.revision || existing.document_hash !== input.documentHash)) {
      throw new LicensingConflictError('CONTROL_ACK_COMMAND_CONFLICT');
    }
  }

  async desiredRevision(edgeId: string): Promise<number> {
    const result = await this.pool.query<{ desired_control_revision: string | number }>(
      `SELECT cs.desired_control_revision FROM cloud_location_control_state cs
       JOIN edges e ON e.location_id=cs.location_id WHERE e.edge_id=$1 AND e.status='ACTIVE'`, [edgeId],
    );
    return Number(result.rows[0]?.desired_control_revision ?? 0);
  }

  async nextDocumentRevision(edgeId: string, documentType: string): Promise<number> {
    const result = await this.pool.query<{ next_revision: number }>(
      `SELECT COALESCE(MAX(revision),0)+1 AS next_revision
       FROM cloud_signed_control_documents WHERE edge_id=$1 AND document_type=$2`,
      [edgeId, documentType],
    );
    return Number(result.rows[0]?.next_revision ?? 1);
  }

  private async mapPlan(row: PlanRow): Promise<CloudPlanRecord> {
    const entitlements = await this.pool.query<{ capability: CapabilityCode }>(
      'SELECT capability FROM cloud_plan_entitlements WHERE plan_id=$1 ORDER BY capability', [row.plan_id],
    );
    return { ...mapPlanRow(row), capabilities: entitlements.rows.map((item) => item.capability) };
  }

  private async insertDocuments(client: PoolClient, documents: NewSignedControlDocument[], now: Date): Promise<void> {
    for (const doc of documents) {
      await client.query(
        `INSERT INTO cloud_signed_control_documents
          (document_id,document_type,tenant_id,location_id,edge_id,revision,kid,document_hash,
           envelope,issued_at,expires_at,grace_until,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [doc.documentId,doc.documentType,doc.tenantId,doc.locationId,doc.edgeId,doc.revision,
          doc.kid,doc.documentHash,JSON.stringify(doc.envelope),doc.issuedAt,doc.expiresAt,doc.graceUntil,now],
      );
    }
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

export class LicensingConflictError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'LicensingConflictError'; }
}

interface PlanRow { plan_id: string; code: string; display_name: string; active: boolean; revision: number; created_at: Date; updated_at: Date }
interface AssignmentRow {
  tenant_id: string; location_id: string; plan_id: string; plan_code: string;
  declared_state: LicenseDeclaredState; license_revision: number; capabilities: CapabilityCode[];
  configuration: EdgeConfiguration; configuration_revision: number;
  flags: Record<string, boolean>; feature_flags_revision: number;
  desired_control_revision: string | number; edge_id: string | null; updated_at: Date;
}
interface DocumentRow {
  document_id: string; document_type: 'LICENSE'|'FEATURE_FLAGS'|'CONFIGURATION'; revision: number;
  kid: string; document_hash: string; envelope: SignedDocumentEnvelope; issued_at: Date;
  expires_at: Date | null; grace_until: Date | null;
}

const assignmentSql = `SELECT ls.tenant_id,ls.location_id,ls.plan_id,p.code AS plan_code,
  ls.declared_state,ls.revision AS license_revision,
  COALESCE((SELECT jsonb_agg(pe.capability ORDER BY pe.capability)
    FROM cloud_plan_entitlements pe WHERE pe.plan_id=ls.plan_id),'[]'::jsonb) AS capabilities,
  cs.configuration,cs.revision AS configuration_revision,
  fs.flags,fs.revision AS feature_flags_revision,
  ctl.desired_control_revision,e.edge_id,ls.updated_at
FROM cloud_location_license_state ls
JOIN cloud_plans p ON p.plan_id=ls.plan_id
JOIN cloud_location_configuration_state cs ON cs.location_id=ls.location_id
JOIN cloud_location_feature_flag_state fs ON fs.location_id=ls.location_id
JOIN cloud_location_control_state ctl ON ctl.location_id=ls.location_id
LEFT JOIN edges e ON e.location_id=ls.location_id AND e.status='ACTIVE'
WHERE ls.location_id=$1`;

function mapPlanRow(row: PlanRow): Omit<CloudPlanRecord, 'capabilities'> {
  return { planId: row.plan_id, code: row.code, displayName: row.display_name, active: row.active,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapAssignment(row: AssignmentRow): LocationLicenseRecord {
  return { tenantId: row.tenant_id, locationId: row.location_id, planId: row.plan_id,
    planCode: row.plan_code, declaredState: row.declared_state, revision: row.license_revision,
    capabilities: row.capabilities, configuration: row.configuration,
    configurationRevision: row.configuration_revision, featureFlags: row.flags,
    featureFlagsRevision: row.feature_flags_revision,
    desiredControlRevision: Number(row.desired_control_revision), activeEdgeId: row.edge_id,
    updatedAt: row.updated_at };
}
function mapDocument(row: DocumentRow): SignedControlDocumentRecord {
  return { documentId: row.document_id, documentType: row.document_type, revision: row.revision,
    kid: row.kid, documentHash: row.document_hash, envelope: row.envelope,
    issuedAt: row.issued_at, expiresAt: row.expires_at, graceUntil: row.grace_until };
}
