import { EntityId } from '@comanview/domain';
import type {
  CapabilityCode,
  EdgeConfiguration,
  LicenseDeclaredState,
  DeviceLimits,
} from '@comanview/contracts';
import type {
  CloudAdminMutationActor,
  CloudLicensingRepository,
  CloudPlanRecord,
  LocationLicenseRecord,
  NewSignedControlDocument,
  SignedControlDocumentRecord,
} from '@comanview/database';
import type { CloudLicensingConfig } from '@comanview/config';
import {
  LICENSE_DOCUMENT_DURATION_MS,
  LICENSE_GRACE_DURATION_MS,
  LICENSE_RENEWAL_WINDOW_MS,
  hashSignedEnvelope,
  signControlDocument,
  signInstallationAuthorization,
  hashPairingCode,
} from '@comanview/licensing';
import { CloudError } from '../app/CloudError.js';

export class CloudLicensingService {
  constructor(
    private readonly repository: CloudLicensingRepository,
    private readonly signing: CloudLicensingConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listPlans() { return this.repository.listPlans(); }
  getLocationAssignment(locationId: string) { return this.repository.getLocationAssignment(locationId); }
  async getAssignmentTenant(locationId: string, planId: string): Promise<string | null> {
    return (await this.repository.getAssignmentContext(locationId, planId))?.tenantId ?? null;
  }

  async createPlan(input: {
    commandId: string; code: string; displayName: string; capabilities: CapabilityCode[]; deviceLimits: DeviceLimits; reason: string;
  }, actor: CloudAdminMutationActor): Promise<CloudPlanRecord> {
    const existing = await this.repository.findIdempotentResult(input.commandId);
    if (existing?.['planId']) {
      const plan = await this.repository.getPlan(String(existing['planId']));
      if (plan) return plan;
    }
    return this.repository.createPlan({
      planId: EntityId.generate().toString(), ...input, actor, now: this.now(),
    });
  }

  async assignLocation(locationId: string, input: {
    commandId: string; planId: string; declaredState: LicenseDeclaredState;
    configuration: EdgeConfiguration; reason: string; expectedRevision: number;
  }, actor: CloudAdminMutationActor): Promise<LocationLicenseRecord> {
    const existingCommand = await this.repository.findIdempotentResult(input.commandId);
    if (existingCommand) {
      const result = await this.repository.getLocationAssignment(locationId);
      if (result) return result;
    }
    const context = await this.repository.getAssignmentContext(locationId, input.planId);
    if (!context) throw new CloudError('LICENSE_ASSIGNMENT_INVALID', 409, 'Location or active plan is not available.');
    const current = await this.repository.getLocationAssignment(locationId);
    const documents = context.activeEdgeId
      ? await this.buildDocuments({
          tenantId: context.tenantId, locationId, edgeId: context.activeEdgeId,
          planCode: context.plan.code, declaredState: input.declaredState,
          capabilities: context.plan.capabilities, configuration: input.configuration,
          deviceLimits: context.plan.deviceLimits,
          featureFlags: current?.featureFlags ?? {}, types: ['LICENSE','CONFIGURATION','FEATURE_FLAGS'],
        })
      : [];
    return this.repository.assignLocation({
      tenantId: context.tenantId, locationId, plan: context.plan,
      declaredState: input.declaredState, configuration: input.configuration,
      documents, expectedRevision: input.expectedRevision,
      commandId: input.commandId, reason: input.reason, actor, now: this.now(),
    });
  }

  async updateState(locationId: string, input: {
    commandId: string; expectedRevision: number; declaredState: LicenseDeclaredState; reason: string;
  }, actor: CloudAdminMutationActor): Promise<LocationLicenseRecord> {
    if (await this.repository.findIdempotentResult(input.commandId)) {
      const current = await this.repository.getLocationAssignment(locationId);
      if (current) return current;
    }
    const current = await this.requireAssignment(locationId);
    const document = current.activeEdgeId
      ? (await this.buildDocuments({ ...current, edgeId: current.activeEdgeId,
          declaredState: input.declaredState, types: ['LICENSE'] }))[0]!
      : null;
    return this.repository.updateLicenseState({ locationId, ...input, document, actor, now: this.now() });
  }

  async updateConfiguration(locationId: string, input: {
    commandId: string; expectedRevision: number; configuration: EdgeConfiguration; reason: string;
  }, actor: CloudAdminMutationActor): Promise<LocationLicenseRecord> {
    if (await this.repository.findIdempotentResult(input.commandId)) {
      const current = await this.repository.getLocationAssignment(locationId);
      if (current) return current;
    }
    const current = await this.requireAssignment(locationId);
    const document = current.activeEdgeId
      ? (await this.buildDocuments({ ...current, edgeId: current.activeEdgeId,
          configuration: input.configuration, types: ['CONFIGURATION'] }))[0]!
      : null;
    return this.repository.updateConfiguration({ locationId, ...input, document, actor, now: this.now() });
  }

  async controlState(edgeId: string) {
    let snapshot = await this.repository.currentDocuments(edgeId);
    if (!snapshot) throw new CloudError('EDGE_LICENSE_NOT_ASSIGNED', 409, 'The active Edge has no assigned license.');
    const byType = new Map(snapshot.documents.map((doc) => [doc.documentType, doc]));
    const now = this.now();
    const missing = (['LICENSE','FEATURE_FLAGS','CONFIGURATION'] as const).filter((type) => !byType.has(type));
    const license = byType.get('LICENSE');
    if (license?.expiresAt && license.expiresAt.getTime() - now.getTime() <= LICENSE_RENEWAL_WINDOW_MS) {
      missing.push('LICENSE');
    }
    if (missing.length > 0) {
      const assignment = snapshot.assignment;
      const documents = await this.buildDocuments({ ...assignment, edgeId, types: [...new Set(missing)] });
      await this.repository.storeDocuments(documents, now);
      snapshot = await this.repository.currentDocuments(edgeId);
      if (!snapshot) throw new CloudError('EDGE_LICENSE_NOT_ASSIGNED', 409, 'The active Edge has no assigned license.');
    }
    const documents = new Map(snapshot.documents.map((doc) => [doc.documentType, doc]));
    return {
      desiredControlRevision: snapshot.assignment.desiredControlRevision,
      cloudTime: now.toISOString(),
      license: responseDocument(documents.get('LICENSE')),
      featureFlags: responseDocument(documents.get('FEATURE_FLAGS')),
      configuration: responseDocument(documents.get('CONFIGURATION')),
    };
  }

  acknowledge(edgeId: string, input: {
    commandId: string; stream: string; revision: number; documentHash: string; appliedAt: string;
  }) {
    return this.repository.acknowledge({
      edgeId, documentType: input.stream, revision: input.revision,
      documentHash: input.documentHash, appliedAt: new Date(input.appliedAt),
      receivedAt: this.now(), commandId: input.commandId,
    });
  }

  desiredRevision(edgeId: string) { return this.repository.desiredRevision(edgeId); }
  getLatestInstallationAuthorization(locationId:string){
    return this.repository.getLatestInstallationAuthorization(locationId,this.now());
  }
  consumeInstallationAuthorization(edgeId:string,input:{commandId:string;authorizationId:string;consumedAt:string}){
    return this.repository.consumeInstallationAuthorization({edgeId,commandId:input.commandId,authorizationId:input.authorizationId,consumedAt:new Date(input.consumedAt)});
  }
  async issueInstallationAuthorization(locationId:string,input:{commandId:string;pairingId:string;pairingCode:string;deviceId:string;
    deviceType:'POS'|'WAITER'|'KDS';displayName:string;initialOwnerDisplayName:string;reason:string},actor:CloudAdminMutationActor){
    const previous = await this.repository.getInstallationAuthorizationByCommand(input.commandId);
    if (previous) return { authorizationId: previous.authorizationId, status: previous.status,
      expiresAt: previous.expiresAt.toISOString(), authorization: previous.envelope };
    const assignment=await this.requireAssignment(locationId);
    if(!assignment.activeEdgeId) throw new CloudError('CLOUD_LOCATION_UNPROVISIONED',409,'Location does not have an ACTIVE Edge.');
    const issuedAt=this.now(),expiresAt=new Date(issuedAt.getTime()+10*60_000),authorizationId=EntityId.generate().toString();
    const payload={formatVersion:1 as const,typ:'comanview-installation-authorization' as const,authorizationId,
      tenantId:assignment.tenantId,locationId,edgeId:assignment.activeEdgeId,pairingId:input.pairingId,
      pairingCodeHash:hashPairingCode(input.pairingId,input.pairingCode),deviceId:input.deviceId,deviceType:input.deviceType,
      displayName:input.displayName,initialOwnerId:EntityId.generate().toString(),initialOwnerDisplayName:input.initialOwnerDisplayName,
      issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()};
    const envelope=signInstallationAuthorization(payload,this.signing.signingKid,this.signing.privateKeyPem);
    const stored = await this.repository.issueInstallationAuthorization({...payload,kid:this.signing.signingKid,envelope,commandId:input.commandId,reason:input.reason,actor,issuedAt,expiresAt});
    return {authorizationId:stored.authorization_id,status:stored.status,expiresAt:stored.expires_at.toISOString(),authorization:stored.envelope};
  }

  private async requireAssignment(locationId: string): Promise<LocationLicenseRecord> {
    const assignment = await this.repository.getLocationAssignment(locationId);
    if (!assignment) throw new CloudError('EDGE_LICENSE_NOT_ASSIGNED', 409, 'Location has no assigned license.');
    return assignment;
  }

  private async buildDocuments(input: {
    tenantId: string; locationId: string; edgeId: string; planCode: string;
    declaredState: LicenseDeclaredState; capabilities: CapabilityCode[];
    deviceLimits: DeviceLimits | null;
    configuration: EdgeConfiguration; featureFlags: Record<string, boolean>;
    types: Array<'LICENSE'|'FEATURE_FLAGS'|'CONFIGURATION'>;
  }): Promise<NewSignedControlDocument[]> {
    const issuedAt = this.now();
    const result: NewSignedControlDocument[] = [];
    for (const type of input.types) {
      const revision = await this.repository.nextDocumentRevision(input.edgeId, type);
      const base = {
        formatVersion: 1 as const, documentId: EntityId.generate().toString(), revision,
        tenantId: input.tenantId, locationId: input.locationId, edgeId: input.edgeId,
        issuedAt: issuedAt.toISOString(),
      };
      const expiresAt = type === 'LICENSE'
        ? new Date(issuedAt.getTime()+LICENSE_DOCUMENT_DURATION_MS) : null;
      const graceUntil = expiresAt
        ? new Date(expiresAt.getTime()+LICENSE_GRACE_DURATION_MS) : null;
      const payload = type === 'LICENSE'
        ? { ...base, documentType: 'LICENSE' as const, declaredState: input.declaredState,
            planCode: input.planCode, capabilities: input.capabilities,
            ...(input.deviceLimits ? { deviceLimits: input.deviceLimits } : {}),
            expiresAt: expiresAt!.toISOString(), graceUntil: graceUntil!.toISOString() }
        : type === 'FEATURE_FLAGS'
          ? { ...base, documentType: 'FEATURE_FLAGS' as const, flags: input.featureFlags }
          : { ...base, documentType: 'CONFIGURATION' as const, configuration: input.configuration };
      const envelope = signControlDocument(payload, this.signing.signingKid, this.signing.privateKeyPem);
      result.push({
        ...base, documentType: type, kid: this.signing.signingKid,
        documentHash: hashSignedEnvelope(envelope), envelope, issuedAt,
        expiresAt, graceUntil,
      });
    }
    return result;
  }
}

function responseDocument(document: SignedControlDocumentRecord | undefined) {
  return document ? { revision: document.revision, envelope: document.envelope,
    documentHash: document.documentHash } : null;
}

export function planResponse(plan: CloudPlanRecord) {
  return { ...plan, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString() };
}
export function assignmentResponse(value: LocationLicenseRecord) {
  return { tenantId: value.tenantId, locationId: value.locationId, planId: value.planId,
    planCode: value.planCode, declaredState: value.declaredState, revision: value.revision,
    capabilities: value.capabilities, deviceLimits:value.deviceLimits, configuration: value.configuration,
    configurationRevision: value.configurationRevision, updatedAt: value.updatedAt.toISOString() };
}
