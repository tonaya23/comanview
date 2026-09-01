import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { EntityId } from '@comanview/domain';
import type {
  CapabilityCode,
  ConfigurationDocumentPayload,
  FeatureFlagsDocumentPayload,
  LicenseDocumentPayload,
  SignedDocumentEnvelope,
} from '@comanview/contracts';
import type { EdgeDatabase } from '../db.js';
import {
  cashSessionProtectedOrders,
  cashSessions,
  edgeControlAckOutbox,
  edgeControlDocuments,
  edgeControlRuntime,
  edgeProtectedOrders,
  orders,
  installationState,
} from '../schema.js';

export type ControlPayload = LicenseDocumentPayload | FeatureFlagsDocumentPayload | ConfigurationDocumentPayload;

export interface EdgeControlRuntimeRecord {
  desiredControlRevision: number;
  lastSuccessfulPullAt: Date | null;
  lastCloudTime: Date | null;
  effectiveTimeFloor: Date | null;
  lastWallTime: Date | null;
  lastCheckpointAt: Date | null;
  clockStatus: 'TRUSTED'|'ROLLBACK_DETECTED'|'FORWARD_JUMP_DETECTED';
  cloudReachable: boolean;
  lastError: string | null;
  stickyDeclaredState: string | null;
  protectedCapabilities: CapabilityCode[];
  restrictionStartedAt: Date | null;
  recoverySessionConsumed: boolean;
}

export class EdgeControlRepository {
  constructor(private readonly db: EdgeDatabase) {}

  getRuntime(): EdgeControlRuntimeRecord {
    const row = this.db.select().from(edgeControlRuntime)
      .where(eq(edgeControlRuntime.singletonKey, 'PRIMARY')).get();
    if (!row) throw new Error('EDGE_CONTROL_RUNTIME_MISSING');
    return { ...row,
      clockStatus: row.clockStatus as EdgeControlRuntimeRecord['clockStatus'],
      protectedCapabilities: JSON.parse(row.protectedCapabilitiesJson) as CapabilityCode[],
    };
  }

  updateRuntime(input: Partial<{
    desiredControlRevision: number; lastSuccessfulPullAt: Date|null; lastCloudTime: Date|null;
    effectiveTimeFloor: Date|null; lastWallTime: Date|null; lastCheckpointAt: Date|null;
    clockStatus: EdgeControlRuntimeRecord['clockStatus']; cloudReachable: boolean; lastError: string|null;
    stickyDeclaredState: string|null; protectedCapabilities: CapabilityCode[];
    restrictionStartedAt: Date|null; recoverySessionConsumed: boolean;
  }>): void {
    const values: Record<string, unknown> = { ...input };
    if (input.protectedCapabilities) {
      values['protectedCapabilitiesJson'] = JSON.stringify(input.protectedCapabilities);
      delete values['protectedCapabilities'];
    }
    this.db.update(edgeControlRuntime).set(values).where(eq(edgeControlRuntime.singletonKey, 'PRIMARY')).run();
  }

  currentDocument<T extends ControlPayload>(type: T['documentType']): {
    payload: T; envelope: SignedDocumentEnvelope; documentHash: string; revision: number;
  } | null {
    const row = this.db.select().from(edgeControlDocuments)
      .where(and(eq(edgeControlDocuments.documentType, type), eq(edgeControlDocuments.isCurrent, true))).get();
    return row ? { payload: JSON.parse(row.payloadJson) as T,
      envelope: JSON.parse(row.envelopeJson) as SignedDocumentEnvelope,
      documentHash: row.documentHash, revision: row.revision } : null;
  }

  applyDocument(input: {
    payload: ControlPayload; envelope: SignedDocumentEnvelope; documentHash: string;
    receivedAt: Date; protectedCapabilities?: CapabilityCode[]; restrictionStartedAt?: Date;
    clearProtectedCapabilities?: boolean;
  }): 'APPLIED'|'UNCHANGED'|'OLDER' {
    return this.db.transaction((tx) => {
      const current = tx.select().from(edgeControlDocuments)
        .where(and(eq(edgeControlDocuments.documentType, input.payload.documentType),
          eq(edgeControlDocuments.isCurrent, true))).get();
      if (current && input.payload.revision < current.revision) return 'OLDER';
      if (current && input.payload.revision === current.revision) {
        if (current.documentHash !== input.documentHash) throw new Error('CONTROL_DOCUMENT_REVISION_HASH_CONFLICT');
        return 'UNCHANGED';
      }
      tx.update(edgeControlDocuments).set({ isCurrent: false })
        .where(eq(edgeControlDocuments.documentType, input.payload.documentType)).run();
      tx.insert(edgeControlDocuments).values({
        documentId: input.payload.documentId, documentType: input.payload.documentType,
        revision: input.payload.revision, documentHash: input.documentHash,
        envelopeJson: JSON.stringify(input.envelope), payloadJson: JSON.stringify(input.payload),
        issuedAt: new Date(input.payload.issuedAt),
        expiresAt: input.payload.documentType === 'LICENSE' ? new Date(input.payload.expiresAt) : null,
        graceUntil: input.payload.documentType === 'LICENSE' ? new Date(input.payload.graceUntil) : null,
        receivedAt: input.receivedAt, isCurrent: true,
      }).run();
      const retained = tx.select({ documentId: edgeControlDocuments.documentId })
        .from(edgeControlDocuments).where(eq(edgeControlDocuments.documentType, input.payload.documentType))
        .orderBy(desc(edgeControlDocuments.revision)).limit(3).all().map((row) => row.documentId);
      if (retained.length === 3) {
        tx.run(sql`DELETE FROM edge_control_documents
          WHERE document_type=${input.payload.documentType} AND is_current=0
            AND document_id NOT IN (${sql.join(retained.map((id) => sql`${id}`), sql`,`)})`);
      }
      tx.insert(edgeControlAckOutbox).values({
        commandId: EntityId.generate().toString(), documentType: input.payload.documentType,
        revision: input.payload.revision, documentHash: input.documentHash, appliedAt: input.receivedAt,
      }).onConflictDoNothing().run();
      if (input.payload.documentType === 'LICENSE') {
        tx.update(edgeControlRuntime).set({
          stickyDeclaredState: ['SUSPENDED','TERMINATED'].includes(input.payload.declaredState)
            ? input.payload.declaredState : null,
          ...(input.protectedCapabilities
            ? { protectedCapabilitiesJson: JSON.stringify(input.protectedCapabilities) } : {}),
          ...(input.clearProtectedCapabilities ? { protectedCapabilitiesJson: '[]' } : {}),
          ...(input.restrictionStartedAt
            ? { restrictionStartedAt: input.restrictionStartedAt } : {}),
          ...(['ACTIVE','PAST_DUE','GRACE_PERIOD'].includes(input.payload.declaredState)
            ? { ...(input.clearProtectedCapabilities ? { restrictionStartedAt: null } : {}),
                recoverySessionConsumed: false } : {}),
        }).where(eq(edgeControlRuntime.singletonKey, 'PRIMARY')).run();
      }
      return 'APPLIED';
    });
  }

  pendingAcks(now: Date) {
    return this.db.select().from(edgeControlAckOutbox)
      .where(and(isNull(edgeControlAckOutbox.ackedAt),
        sql`(${edgeControlAckOutbox.nextAttemptAt} IS NULL OR ${edgeControlAckOutbox.nextAttemptAt} <= ${now.getTime()})`)).all();
  }
  markAcked(commandId: string, at: Date): void {
    this.db.update(edgeControlAckOutbox).set({ ackedAt: at, lastError: null })
      .where(eq(edgeControlAckOutbox.commandId, commandId)).run();
  }
  markAckFailed(commandId: string, error: string, nextAttemptAt: Date): void {
    this.db.update(edgeControlAckOutbox).set({ attemptCount: sql`${edgeControlAckOutbox.attemptCount}+1`,
      lastError: error.slice(0,500), nextAttemptAt }).where(eq(edgeControlAckOutbox.commandId, commandId)).run();
  }
  pendingInstallationAuthorizationAck(now:Date){
    const row=this.db.select().from(installationState).where(eq(installationState.singletonKey,'PRIMARY')).get();
    return row?.bootstrapStatus==='COMPLETED'&&row.authorizationId&&row.cloudAckCommandId&&!row.cloudAcknowledgedAt&&
      (!row.cloudAckNextAttemptAt||row.cloudAckNextAttemptAt<=now)
      ? {commandId:row.cloudAckCommandId,authorizationId:row.authorizationId,consumedAt:row.completedAt!,attemptCount:row.cloudAckAttemptCount}:null;
  }
  markInstallationAuthorizationAcked(at:Date):void{this.db.update(installationState).set({cloudAcknowledgedAt:at,cloudAckLastError:null}).where(eq(installationState.singletonKey,'PRIMARY')).run();}
  markInstallationAuthorizationAckFailed(error:string,nextAttemptAt:Date):void{this.db.update(installationState).set({cloudAckAttemptCount:sql`${installationState.cloudAckAttemptCount}+1`,cloudAckLastError:error.slice(0,500),cloudAckNextAttemptAt:nextAttemptAt}).where(eq(installationState.singletonKey,'PRIMARY')).run();}

  getOpenCashSession(): {
    id: string; purpose: string; openedLicenseRevision: number|null; openedLicenseMode: string|null;
  } | null {
    return this.db.select({ id: cashSessions.id, purpose: cashSessions.purpose,
      openedLicenseRevision: cashSessions.openedLicenseRevision,
      openedLicenseMode: cashSessions.openedLicenseMode })
      .from(cashSessions).where(eq(cashSessions.status, 'OPEN')).get() ?? null;
  }

  captureOpenOrders(licenseRevision: number | null, now: Date): string[] {
    return this.db.transaction((tx) => {
      const open = tx.select({ id: orders.id }).from(orders).where(eq(orders.status, 'OPEN')).all();
      for (const order of open) tx.insert(edgeProtectedOrders).values({ orderId: order.id,
        capturedAt: now, licenseRevision }).onConflictDoNothing().run();
      return open.map((order) => order.id);
    });
  }

  refreshProtectedOrders(now: Date): string[] {
    this.db.run(sql`UPDATE edge_protected_orders SET resolved_at=${now.getTime()}
      WHERE resolved_at IS NULL AND order_id IN (SELECT id FROM orders WHERE status <> 'OPEN')`);
    return this.db.select({ orderId: edgeProtectedOrders.orderId }).from(edgeProtectedOrders)
      .where(isNull(edgeProtectedOrders.resolvedAt)).all().map((row) => row.orderId);
  }

  isProtectedOrder(orderId: string): boolean {
    return Boolean(this.db.select({ orderId: edgeProtectedOrders.orderId }).from(edgeProtectedOrders)
      .where(and(eq(edgeProtectedOrders.orderId, orderId), isNull(edgeProtectedOrders.resolvedAt))).get());
  }

  wasProtectedOrder(orderId: string): boolean {
    return Boolean(this.db.select({ orderId: edgeProtectedOrders.orderId }).from(edgeProtectedOrders)
      .where(eq(edgeProtectedOrders.orderId, orderId)).get());
  }

  bindRecoverySession(cashSessionId: string, orderIds: string[]): void {
    this.db.transaction((tx) => {
      for (const orderId of orderIds) tx.insert(cashSessionProtectedOrders)
        .values({ cashSessionId, orderId }).onConflictDoNothing().run();
      tx.update(edgeControlRuntime).set({ recoverySessionConsumed: true })
        .where(eq(edgeControlRuntime.singletonKey, 'PRIMARY')).run();
    });
  }

  recoverySessionAllows(cashSessionId: string, orderId: string): boolean {
    return Boolean(this.db.select().from(cashSessionProtectedOrders).where(and(
      eq(cashSessionProtectedOrders.cashSessionId, cashSessionId),
      eq(cashSessionProtectedOrders.orderId, orderId),
    )).get());
  }
}
