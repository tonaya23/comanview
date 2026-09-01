import { performance } from 'node:perf_hooks';
import type {
  CapabilityCode,
  EdgeConfiguration,
  ConfigurationDocumentPayload,
  EffectiveCapabilitiesResponse,
  EffectiveLicenseMode,
  LicenseDocumentPayload,
  DeviceLimits,
  DeviceType,
} from '@comanview/contracts';
import { EdgeControlStateResponseSchema } from '@comanview/contracts';
import type { EdgeControlRepository } from '@comanview/database';
import type { EdgeLicensingConfig } from '@comanview/config';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  SUSPICIOUS_RESTART_FORWARD_JUMP_MS,
  assertDocumentBinding,
  verifyControlDocument,
} from '@comanview/licensing';
import { AppError } from '../../app/errorHandler.js';
import { ControlTransportError, type HttpControlTransport } from './HttpControlTransport.js';

export type LicensingAction =
  | 'ORDER_CREATE' | 'ORDER_ADD_ITEM' | 'ORDER_SEND' | 'ORDER_CLOSE' | 'ORDER_CANCEL'
  | 'PAYMENT_CREATE' | 'PAYMENT_VOID' | 'CASH_SESSION_OPEN_NORMAL' | 'CASH_SESSION_OPEN_RECOVERY'
  | 'CASH_MOVEMENT' | 'CASH_REPORT' | 'CASH_CLOSE' | 'KDS_UPDATE' | 'PRINT';

const DEFAULT_CONFIGURATION: EdgeConfiguration = {
  payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000,1500,2000] },
};
const NORMAL_MODES: EffectiveLicenseMode[] = ['FULL','FULL_WITH_WARNING','GRACE_OPERATING'];
type ControlLog = { warn(context: Record<string, unknown>, message: string): void };
const SILENT_LOG: ControlLog = { warn: () => undefined };

export class EdgeLicenseManager {
  private readonly bootMonotonic = performance.now();
  private readonly bootWall = Date.now();
  private pullRunning = false;

  constructor(
    private readonly repository: EdgeControlRepository,
    private readonly transport: HttpControlTransport | null,
    private readonly config: EdgeLicensingConfig,
    private readonly binding: { tenantId: string; locationId: string; edgeId: string },
    private readonly log: ControlLog = SILENT_LOG,
  ) {
    if (config.enforcementEnabled) this.detectRestartClockAnomaly();
  }

  enabled(): boolean { return this.config.enforcementEnabled; }

  noteDesiredRevision(revision: number): void {
    const current = this.repository.getRuntime();
    if (revision > current.desiredControlRevision) {
      this.repository.updateRuntime({ desiredControlRevision: revision });
      void this.pullOnce();
    }
  }

  async pullOnce(): Promise<void> {
    if (!this.config.enforcementEnabled || !this.transport || this.pullRunning) return;
    this.pullRunning = true;
    let stage = 'PULL_REQUEST';
    let stream: string | undefined;
    try {
      const response = EdgeControlStateResponseSchema.parse(await this.transport.pull());
      stage = 'DOCUMENT_VALIDATION';
      const cloudTime = new Date(response.cloudTime);
      for (const document of [response.license,response.featureFlags,response.configuration]) {
        if (!document) continue;
        const verified = verifyControlDocument(document.envelope, this.config.publicKeyring);
        stream = verified.payload.documentType;
        assertDocumentBinding(verified.payload, this.binding);
        if (verified.documentHash !== document.documentHash) throw new Error('CONTROL_DOCUMENT_HASH_MISMATCH');
        const incomingLicense = verified.payload.documentType === 'LICENSE' ? verified.payload : null;
        const oldLicense = incomingLicense
          ? this.repository.currentDocument<LicenseDocumentPayload>('LICENSE')?.payload : null;
        const open = this.repository.getOpenCashSession();
        const reductions = oldLicense
          ? oldLicense.capabilities.filter((capability) => !incomingLicense!.capabilities.includes(capability))
          : [];
        const expansions = oldLicense
          ? incomingLicense!.capabilities.filter((capability) => !oldLicense.capabilities.includes(capability))
          : incomingLicense?.capabilities ?? [];
        const clearsRestriction = Boolean(incomingLicense &&
          ['ACTIVE','PAST_DUE','GRACE_PERIOD'].includes(incomingLicense.declaredState) &&
          reductions.length === 0 &&
          (!oldLicense || ['SUSPENDED','TERMINATED'].includes(oldLicense.declaredState) || expansions.length > 0));
        const protectedCapabilities = reductions.length > 0
          ? [...new Set([...this.repository.getRuntime().protectedCapabilities,...oldLicense!.capabilities])]
          : undefined;
        const application = this.repository.applyDocument({ payload: verified.payload, envelope: document.envelope,
          documentHash: verified.documentHash, receivedAt: cloudTime,
          ...(protectedCapabilities ? { protectedCapabilities } : {}),
          ...(reductions.length > 0 && !open ? { restrictionStartedAt: cloudTime } : {}),
          ...(clearsRestriction ? { clearProtectedCapabilities: true } : {}) });
        if (application === 'APPLIED' && incomingLicense && reductions.length > 0 && !open) {
          this.repository.captureOpenOrders(incomingLicense.revision, cloudTime);
        }
      }
      stage = 'RUNTIME_PERSISTENCE';
      const previousFloor = this.repository.getRuntime().effectiveTimeFloor?.getTime() ?? 0;
      this.repository.updateRuntime({
        desiredControlRevision: response.desiredControlRevision,
        lastSuccessfulPullAt: new Date(), lastCloudTime: cloudTime,
        effectiveTimeFloor: new Date(Math.max(previousFloor, cloudTime.getTime())),
        lastWallTime: new Date(), lastCheckpointAt: new Date(),
        clockStatus: 'TRUSTED', cloudReachable: true, lastError: null,
      });
      stage = 'ACK_FLUSH';
      await this.flushAcks();
    } catch (error) {
      const failure = safeControlFailure(error, stage);
      this.repository.updateRuntime({ cloudReachable: false,
        lastError: failure.code });
      this.log.warn({ component: 'edge-control', operation: 'pull', ...failure,
        ...(stream ? { stream } : {}) }, 'Cloud control-state pull failed');
    } finally { this.pullRunning = false; }
  }

  async flushAcks(now = new Date()): Promise<void> {
    if (!this.transport) return;
    for (const ack of this.repository.pendingAcks(now)) {
      try {
        await this.transport.acknowledge({ commandId: ack.commandId, stream: ack.documentType,
          revision: ack.revision, documentHash: ack.documentHash, appliedAt: ack.appliedAt.toISOString() });
        this.repository.markAcked(ack.commandId, now);
      } catch (error) {
        const failure = safeControlFailure(error, 'ACK_REQUEST');
        const delay = Math.min(1_000 * 2 ** Math.min(ack.attemptCount, 12), this.config.maxBackoffMs);
        this.repository.markAckFailed(ack.commandId, failure.code, new Date(now.getTime()+delay));
        this.log.warn({ component: 'edge-control', operation: 'ack', ...failure,
          stream: ack.documentType, revision: ack.revision, attempt: ack.attemptCount + 1 },
        'Cloud control-state ACK failed');
      }
    }
    const installation=this.repository.pendingInstallationAuthorizationAck(now);
    if(installation)try{
      await this.transport.acknowledgeInstallation({commandId:installation.commandId,authorizationId:installation.authorizationId,consumedAt:installation.consumedAt.toISOString()});
      this.repository.markInstallationAuthorizationAcked(now);
    }catch(error){const failure=safeControlFailure(error,'ACK_REQUEST');const delay=Math.min(1_000*2**Math.min(installation.attemptCount,12),this.config.maxBackoffMs);this.repository.markInstallationAuthorizationAckFailed(failure.code,new Date(now.getTime()+delay));this.log.warn({component:'edge-control',operation:'installation-ack',...failure,attempt:installation.attemptCount+1},'Cloud installation authorization ACK failed');}
  }

  checkpoint(): void {
    if (!this.config.enforcementEnabled) return;
    const effective = this.effectiveNow();
    const wall = Date.now();
    const expected = this.bootWall + (performance.now()-this.bootMonotonic);
    let clockStatus = this.repository.getRuntime().clockStatus;
    if (wall < expected-CLOCK_SKEW_TOLERANCE_MS) clockStatus = 'ROLLBACK_DETECTED';
    if (wall > expected+CLOCK_SKEW_TOLERANCE_MS) clockStatus = 'FORWARD_JUMP_DETECTED';
    this.repository.updateRuntime({ effectiveTimeFloor: effective, lastWallTime: new Date(wall),
      lastCheckpointAt: new Date(), clockStatus });
  }

  effectiveCapabilities(): EffectiveCapabilitiesResponse {
    if (!this.config.enforcementEnabled) return {
      mode: 'FULL', declaredState: null,
      capabilities: ['CORE_POS','TABLE_SERVICE','KDS','PRINTING'],
      deviceLimits: { POS:null, WAITER:null, KDS:null },
      licenseRevision: null, featureFlagsRevision: null, configurationRevision: null,
      cloudReachable: this.repository.getRuntime().cloudReachable,
      expiresAt: null, graceUntil: null, reasonCode: 'LICENSING_DISABLED_FOR_DEVELOPMENT',
      protectedOrderCount: 0, clockStatus: 'TRUSTED',
    };
    const runtime = this.repository.getRuntime();
    const license = this.repository.currentDocument<LicenseDocumentPayload>('LICENSE');
    const flags = this.repository.currentDocument('FEATURE_FLAGS');
    const configuration = this.repository.currentDocument('CONFIGURATION');
    const openSession = this.repository.getOpenCashSession();
    const protectedOrders = this.repository.refreshProtectedOrders(new Date());
    if (!license) {
      const proven = Boolean(openSession?.openedLicenseRevision && openSession.openedLicenseMode &&
        NORMAL_MODES.includes(openSession.openedLicenseMode as EffectiveLicenseMode));
      return this.response(proven ? 'GUARANTEED_SHIFT_RECOVERY' : 'NO_VALID_LICENSE', null,
        proven ? runtime.protectedCapabilities : [], proven ? 'DURABLE_SHIFT_AUTHORIZATION_PROOF' : 'NO_VALID_LICENSE',
        protectedOrders.length, flags?.revision ?? null, configuration?.revision ?? null);
    }
    const now = this.effectiveNow().getTime();
    const payload = license.payload;
    const capabilities = filterFeatureFlags(payload.capabilities,
      this.repository.currentDocument('FEATURE_FLAGS')?.payload);
    const sticky = runtime.stickyDeclaredState ?? payload.declaredState;
    if (!openSession && runtime.restrictionStartedAt && protectedOrders.length > 0) {
      return this.response('PROTECTED_OPERATIONS', payload,
        union(capabilities,runtime.protectedCapabilities), 'ENTITLEMENT_REDUCTION_PROTECTED_ORDERS',
        protectedOrders.length, flags?.revision ?? null, configuration?.revision ?? null);
    }
    if (!openSession && runtime.protectedCapabilities.length > 0 && protectedOrders.length === 0 &&
      ['ACTIVE','PAST_DUE','GRACE_PERIOD'].includes(sticky)) {
      this.repository.updateRuntime({ protectedCapabilities: [], restrictionStartedAt: null });
    }
    const shiftCapabilities = openSession ? runtime.protectedCapabilities : [];
    if (openSession?.purpose === 'LICENSE_RECOVERY') {
      return this.response('GUARANTEED_SHIFT_RECOVERY', payload, capabilities,
        'LICENSE_RECOVERY_SESSION', protectedOrders.length, flags?.revision ?? null,
        configuration?.revision ?? null);
    }
    if (sticky === 'SUSPENDED' || sticky === 'TERMINATED') {
      if (openSession && this.sessionHasDurableProof(openSession)) {
        return this.response('GUARANTEED_SHIFT', payload,
          union(capabilities,shiftCapabilities), `${sticky}_SHIFT_PROTECTED`, protectedOrders.length,
          flags?.revision ?? null, configuration?.revision ?? null);
      }
      const captured = protectedOrders.length > 0 ? protectedOrders
        : this.repository.captureOpenOrders(payload.revision, new Date());
      if (captured.length > 0) return this.response('PROTECTED_OPERATIONS', payload, capabilities,
        `${sticky}_PROTECTED_ORDERS`, captured.length, flags?.revision ?? null, configuration?.revision ?? null);
      return this.response(sticky === 'SUSPENDED' ? 'SUSPENDED_BLOCKED' : 'TERMINATED_BLOCKED',
        payload, [], sticky, 0, flags?.revision ?? null, configuration?.revision ?? null);
    }
    if (runtime.clockStatus === 'FORWARD_JUMP_DETECTED') {
      if (openSession && this.sessionHasDurableProof(openSession)) return this.response('GUARANTEED_SHIFT', payload,
        union(capabilities,shiftCapabilities), 'CLOCK_FORWARD_JUMP_SHIFT_PROTECTED', protectedOrders.length,
        flags?.revision ?? null, configuration?.revision ?? null);
      return this.response('CLOCK_SUSPECT', payload, [], 'CLOCK_FORWARD_JUMP_DETECTED', protectedOrders.length,
        flags?.revision ?? null, configuration?.revision ?? null);
    }
    if (now <= Date.parse(payload.expiresAt)) {
      const mode = payload.declaredState === 'PAST_DUE' ? 'FULL_WITH_WARNING'
        : payload.declaredState === 'GRACE_PERIOD' ? 'GRACE_OPERATING' : 'FULL';
      return this.response(mode, payload, union(capabilities,shiftCapabilities), payload.declaredState,
        protectedOrders.length, flags?.revision ?? null, configuration?.revision ?? null);
    }
    if (now <= Date.parse(payload.graceUntil)) return this.response('GRACE_OPERATING', payload,
      union(capabilities,shiftCapabilities), 'SIGNED_GRACE_WINDOW', protectedOrders.length,
      flags?.revision ?? null, configuration?.revision ?? null);
    if (openSession && this.sessionHasDurableProof(openSession)) return this.response('GUARANTEED_SHIFT', payload,
      union(capabilities,shiftCapabilities), 'POST_GRACE_SHIFT_PROTECTED', protectedOrders.length,
      flags?.revision ?? null, configuration?.revision ?? null);
    const captured = protectedOrders.length > 0 ? protectedOrders
      : this.repository.captureOpenOrders(payload.revision, new Date());
    if (captured.length > 0) return this.response('PROTECTED_OPERATIONS', payload, capabilities,
      'POST_GRACE_PROTECTED_ORDERS', captured.length, flags?.revision ?? null, configuration?.revision ?? null);
    return this.response('POST_GRACE_BLOCKED', payload, [], 'SIGNED_GRACE_EXPIRED', 0,
      flags?.revision ?? null, configuration?.revision ?? null);
  }

  assertAllowed(action: LicensingAction, capability: CapabilityCode, orderId?: string): void {
    const effective = this.effectiveCapabilities();
    if (!effective.capabilities.includes(capability)) throw denied(effective, capability);
    if (NORMAL_MODES.includes(effective.mode)) return;
    if (effective.mode === 'GUARANTEED_SHIFT') {
      if (action === 'CASH_SESSION_OPEN_NORMAL' || action === 'CASH_SESSION_OPEN_RECOVERY') throw denied(effective, capability);
      return;
    }
    if (effective.mode === 'GUARANTEED_SHIFT_RECOVERY') {
      if (action === 'CASH_REPORT' || action === 'CASH_CLOSE') return;
      const isProtected = orderId && (action === 'PRINT'
        ? this.repository.wasProtectedOrder(orderId) : this.repository.isProtectedOrder(orderId));
      const allowed = isProtected &&
        ['ORDER_SEND','ORDER_CLOSE','PAYMENT_CREATE','KDS_UPDATE','PRINT'].includes(action);
      if (allowed) return;
      throw denied(effective, capability);
    }
    if (effective.mode === 'PROTECTED_OPERATIONS') {
      if (action === 'CASH_SESSION_OPEN_RECOVERY') {
        if (this.repository.getRuntime().recoverySessionConsumed) throw new AppError(
          'LICENSE_RECOVERY_ALREADY_USED', 409, 'La sesión de recuperación ya fue utilizada.');
        return;
      }
      const isProtected = orderId && (action === 'PRINT'
        ? this.repository.wasProtectedOrder(orderId) : this.repository.isProtectedOrder(orderId));
      const allowed = isProtected &&
        ['ORDER_SEND','ORDER_CLOSE','PAYMENT_CREATE','KDS_UPDATE','PRINT'].includes(action);
      if (allowed) return;
    }
    throw denied(effective, capability);
  }

  assertCapabilityAvailable(capability: CapabilityCode): void {
    const effective = this.effectiveCapabilities();
    if (!effective.capabilities.includes(capability) ||
      ['POST_GRACE_BLOCKED','SUSPENDED_BLOCKED','TERMINATED_BLOCKED','NO_VALID_LICENSE','CLOCK_SUSPECT'].includes(effective.mode)) {
      throw denied(effective, capability);
    }
  }

  hasCapability(capability: CapabilityCode): boolean {
    try { this.assertCapabilityAvailable(capability); return true; } catch { return false; }
  }

  currentConfiguration(): EdgeConfiguration {
    return this.repository.currentDocument<ConfigurationDocumentPayload>('CONFIGURATION')
      ?.payload.configuration ?? DEFAULT_CONFIGURATION;
  }
  currentDeviceLimits(): DeviceLimits | undefined {
    if (!this.config.enforcementEnabled) return { POS:null, WAITER:null, KDS:null };
    return this.repository.currentDocument<LicenseDocumentPayload>('LICENSE')?.payload.deviceLimits;
  }
  assertDevicePairingAllowed(type: DeviceType, activeCount: number): void {
    const capability: CapabilityCode = type === 'POS' ? 'CORE_POS' : type === 'WAITER' ? 'TABLE_SERVICE' : 'KDS';
    this.assertCapabilityAvailable(capability);
    const limits=this.currentDeviceLimits();
    if (!limits) throw new AppError('DEVICE_LIMITS_UNAVAILABLE',409,'La licencia no contiene límites de dispositivos.');
    const limit=limits[type];
    if (limit !== null && activeCount >= limit) throw new AppError('DEVICE_LIMIT_REACHED',409,`Se alcanzó el límite de dispositivos ${type}.`);
  }

  currentOpenAuthorization() {
    const effective = this.effectiveCapabilities();
    return { revision: effective.licenseRevision, mode: effective.mode };
  }

  bindRecoverySession(cashSessionId: string): void {
    const orderIds = this.repository.refreshProtectedOrders(new Date());
    if (orderIds.length === 0) throw new AppError('LICENSE_RECOVERY_NO_ORDERS', 409,
      'No existen Orders protegidas que requieran recuperación.');
    this.repository.bindRecoverySession(cashSessionId, orderIds);
  }

  protectedOrderIds(): string[] { return this.repository.refreshProtectedOrders(new Date()); }

  private response(mode: EffectiveLicenseMode, payload: LicenseDocumentPayload|null,
    capabilities: CapabilityCode[], reasonCode: string, protectedOrderCount: number,
    featureFlagsRevision: number|null, configurationRevision: number|null): EffectiveCapabilitiesResponse {
    const runtime = this.repository.getRuntime();
    return { mode, declaredState: payload?.declaredState ?? null, capabilities,
      ...(payload?.deviceLimits ? { deviceLimits:payload.deviceLimits } : {}),
      licenseRevision: payload?.revision ?? null, featureFlagsRevision, configurationRevision,
      cloudReachable: runtime.cloudReachable, expiresAt: payload?.expiresAt ?? null,
      graceUntil: payload?.graceUntil ?? null, reasonCode, protectedOrderCount,
      clockStatus: runtime.clockStatus };
  }

  private sessionHasDurableProof(session: { openedLicenseRevision: number|null; openedLicenseMode: string|null }) {
    return Boolean(session.openedLicenseRevision && session.openedLicenseMode &&
      NORMAL_MODES.includes(session.openedLicenseMode as EffectiveLicenseMode));
  }

  private effectiveNow(): Date {
    const runtime = this.repository.getRuntime();
    const monotonicNow = this.bootWall + (performance.now()-this.bootMonotonic);
    return new Date(Math.max(monotonicNow, runtime.effectiveTimeFloor?.getTime() ?? 0));
  }

  private detectRestartClockAnomaly(): void {
    const runtime = this.repository.getRuntime();
    const floor = runtime.effectiveTimeFloor?.getTime();
    if (!floor) return;
    if (this.bootWall < floor-CLOCK_SKEW_TOLERANCE_MS) {
      this.repository.updateRuntime({ clockStatus: 'ROLLBACK_DETECTED', lastWallTime: new Date(this.bootWall) });
    } else if (this.bootWall > floor+SUSPICIOUS_RESTART_FORWARD_JUMP_MS) {
      this.repository.updateRuntime({ clockStatus: 'FORWARD_JUMP_DETECTED', lastWallTime: new Date(this.bootWall) });
    }
  }
}

function union(a: CapabilityCode[], b: CapabilityCode[]): CapabilityCode[] {
  return [...new Set([...a,...b])];
}
function filterFeatureFlags(capabilities: CapabilityCode[], raw: unknown): CapabilityCode[] {
  const flags = raw && typeof raw === 'object' && 'flags' in raw
    ? (raw as { flags: Record<string, boolean> }).flags : {};
  return capabilities.filter((capability) => {
    if (capability === 'TABLE_SERVICE') return flags['tables.enabled'] !== false;
    if (capability === 'KDS') return flags['kds.enabled'] !== false;
    if (capability === 'PRINTING') return flags['printing.enabled'] !== false;
    return true;
  });
}
function denied(effective: EffectiveCapabilitiesResponse, capability: CapabilityCode) {
  return new AppError('LICENSE_CAPABILITY_DENIED', 403,
    `La operación requiere ${capability} y no está disponible en el modo ${effective.mode}.`,
    { mode: effective.mode, capability, reasonCode: effective.reasonCode });
}

function safeControlFailure(error: unknown, fallbackStage: string): {
  code: string; stage: string; status?: number;
} {
  if (error instanceof ControlTransportError) {
    return { code: error.code, stage: error.stage,
      ...(error.status === undefined ? {} : { status: error.status }) };
  }
  const message = error instanceof Error ? error.message : '';
  const knownCodes = new Set([
    'CONTROL_DOCUMENT_UNKNOWN_KID',
    'CONTROL_DOCUMENT_INVALID_SIGNATURE',
    'CONTROL_DOCUMENT_TYPE_MISMATCH',
    'CONTROL_DOCUMENT_BINDING_MISMATCH',
    'CONTROL_DOCUMENT_HASH_MISMATCH',
    'CONTROL_DOCUMENT_REVISION_HASH_CONFLICT',
  ]);
  if (knownCodes.has(message)) return { code: message, stage: fallbackStage };
  return { code: `CONTROL_${fallbackStage}_FAILED`, stage: fallbackStage };
}
