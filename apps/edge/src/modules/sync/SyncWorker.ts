import { EntityId } from '@comanview/domain';
import type { SyncOutboxRepository, SyncOutboxEvent } from '@comanview/database';
import {
  SYNC_EVENT_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  SyncBatchRequestSchema,
  calculateRetryDelayMs,
  inferAggregateType,
  type EdgeHeartbeat,
  type SyncEventEnvelope,
  type SyncStatus,
} from '@comanview/sync';
import type { EdgeSyncConfig } from '@comanview/config';
import { CloudTransportError, type CloudSyncTransport } from './HttpCloudSyncTransport.js';

interface SyncLogger {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
}

export class SyncWorker {
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: SyncOutboxRepository,
    private readonly transport: CloudSyncTransport | null,
    private readonly config: EdgeSyncConfig,
    private readonly logger: SyncLogger,
  ) {}

  start(): void {
    if (!this.config.enabled || !this.transport || this.pollTimer) return;
    void this.runOnce();
    void this.sendHeartbeat();
    this.pollTimer = setInterval(() => void this.runOnce(), this.config.pollIntervalMs);
    this.heartbeatTimer = setInterval(
      () => void this.sendHeartbeat(),
      this.config.heartbeatIntervalMs,
    );
    this.pollTimer.unref();
    this.heartbeatTimer.unref();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
  }

  async runOnce(now = new Date()): Promise<void> {
    if (!this.config.enabled || !this.transport || this.running) return;
    this.running = true;
    const events = this.repository.claimBatch(
      this.config.batchSize,
      this.config.leaseDurationMs,
      now,
    );
    if (events.length === 0) {
      this.running = false;
      return;
    }
    try {
      const identity = this.repository.getIdentity();
      const envelopes: SyncEventEnvelope[] = [];
      const sendableEvents = new Map<string, SyncOutboxEvent>();
      for (const event of events) {
        try {
          const envelope = this.toEnvelope(event, identity);
          envelopes.push(envelope);
          sendableEvents.set(event.id, event);
        } catch (error) {
          this.repository.markFailed(event.id, this.errorMessage(error), null);
        }
      }
      if (envelopes.length === 0) return;
      const batch = SyncBatchRequestSchema.parse({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        edgeId: identity.edgeId,
        tenantId: identity.tenantId,
        locationId: identity.locationId,
        batchId: EntityId.generate().toString(),
        events: envelopes,
      });
      const acknowledgement = await this.transport.sendBatch(batch);
      if (acknowledgement.batchId !== batch.batchId) {
        throw new CloudTransportError(
          null,
          'Cloud acknowledgement batchId does not match request.',
        );
      }
      const sentIds = new Set(envelopes.map((event) => event.eventId));
      const resultIds = [
        ...acknowledgement.accepted,
        ...acknowledgement.duplicates,
        ...acknowledgement.rejected.map((item) => item.eventId),
      ];
      if (
        resultIds.some((eventId) => !sentIds.has(eventId)) ||
        new Set(resultIds).size !== resultIds.length
      ) {
        throw new CloudTransportError(
          null,
          'Cloud acknowledgement contains unexpected or repeated event IDs.',
        );
      }
      const acknowledged = new Set([...acknowledgement.accepted, ...acknowledgement.duplicates]);
      this.repository.markSynced([...acknowledged], now);
      for (const rejection of acknowledgement.rejected) {
        this.repository.markFailed(
          rejection.eventId,
          `${rejection.code}: ${rejection.message}`,
          null,
        );
      }
      for (const envelope of envelopes) {
        if (
          !acknowledged.has(envelope.eventId) &&
          !acknowledgement.rejected.some((item) => item.eventId === envelope.eventId)
        ) {
          this.markTransientFailure(
            sendableEvents.get(envelope.eventId)!,
            'Cloud acknowledgement omitted event.',
            now,
          );
        }
      }
      this.repository.recordSyncSuccess(now);
      this.logger.info(
        {
          batchId: batch.batchId,
          acceptedCount: acknowledgement.accepted.length,
          duplicateCount: acknowledgement.duplicates.length,
          rejectedCount: acknowledgement.rejected.length,
        },
        'Cloud sync batch acknowledged',
      );
    } catch (error) {
      const message = this.errorMessage(error);
      const retryableEvents = events.filter((event) => {
        const current = this.repository.getEventStatus(event.id);
        return current === 'SYNCING';
      });
      for (const event of retryableEvents) this.markTransientFailure(event, message, now, error);
      this.repository.recordCloudFailure(message);
      this.logger.warn(
        { statusCode: error instanceof CloudTransportError ? error.statusCode : null },
        'Cloud sync attempt failed',
      );
    } finally {
      this.running = false;
    }
  }

  async sendHeartbeat(now = new Date()): Promise<void> {
    if (!this.config.enabled || !this.transport) return;
    const identity = this.repository.getIdentity();
    const counts = this.repository.getCounts();
    const heartbeat: EdgeHeartbeat = {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      edgeId: identity.edgeId,
      tenantId: identity.tenantId,
      locationId: identity.locationId,
      edgeVersion: this.config.edgeVersion,
      schemaVersion: this.config.schemaVersion,
      timestamp: now.toISOString(),
      status: counts.failedCount > 0 ? 'DEGRADED' : 'ONLINE',
      pendingEventCount: counts.pendingCount + counts.failedCount + counts.syncingCount,
    };
    try {
      await this.transport.sendHeartbeat(heartbeat);
      this.repository.recordHeartbeatSuccess(now);
    } catch (error) {
      this.repository.recordCloudFailure(this.errorMessage(error));
    }
  }

  status(): SyncStatus {
    const identity = this.repository.getIdentity();
    const state = this.repository.getState();
    const counts = this.repository.getCounts();
    return {
      enabled: this.config.enabled,
      edgeId: identity.edgeId,
      cloudReachable: state.cloudReachable,
      lastSuccessfulSyncAt: state.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastHeartbeatAt: state.lastHeartbeatAt?.toISOString() ?? null,
      pendingCount: counts.pendingCount + counts.failedCount + counts.syncingCount,
      failedCount: counts.failedCount,
      syncingCount: counts.syncingCount,
      lastError: state.lastError ?? this.repository.getLatestFailedError(),
    };
  }

  private toEnvelope(
    event: SyncOutboxEvent,
    identity: { edgeId: string; tenantId: string; locationId: string },
  ): SyncEventEnvelope {
    const payload: unknown = JSON.parse(event.payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Outbox payload must be a JSON object.');
    }
    return {
      schemaVersion: SYNC_EVENT_SCHEMA_VERSION,
      eventId: event.id,
      eventType: event.eventType,
      aggregateType:
        event.aggregateType === 'UNKNOWN'
          ? inferAggregateType(event.eventType)
          : event.aggregateType,
      aggregateId: event.aggregateId,
      tenantId: identity.tenantId,
      locationId: identity.locationId,
      edgeId: identity.edgeId,
      occurredAt: event.occurredAt.toISOString(),
      localSequence: event.localSequence,
      aggregateVersion: event.aggregateVersion,
      payload: payload as Record<string, unknown>,
    };
  }

  private markTransientFailure(
    event: SyncOutboxEvent,
    message: string,
    now: Date,
    error?: unknown,
  ): void {
    const statusCode = error instanceof CloudTransportError ? error.statusCode : null;
    const permanent = statusCode !== null && [400, 409, 413, 422].includes(statusCode);
    const delay =
      statusCode === 401 || statusCode === 403
        ? 300_000
        : calculateRetryDelayMs(event.attemptCount);
    const nextAttemptAt = permanent ? null : new Date(now.getTime() + delay);
    this.repository.markFailed(event.id, message, nextAttemptAt);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown sync error.';
  }
}
