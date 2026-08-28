import type { Pool, PoolClient } from 'pg';

export const OPERATIONAL_PROJECTION_NAME = 'operational_summaries';

export type ProjectionOutcome = 'PROCESSED' | 'SKIPPED_UNHANDLED' | 'DEAD_LETTER';

export interface ClaimedCloudEvent {
  eventId: string;
  schemaVersion: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number | null;
  tenantId: string;
  locationId: string;
  edgeId: string;
  localSequence: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
  processingAttemptCount: number;
}

interface EventContext {
  eventId: string;
  tenantId: string;
  locationId: string;
  edgeId: string;
  aggregateId: string;
  localSequence: number;
  occurredAt: Date;
}

export type ProjectionAction =
  | { type: 'NOOP' }
  | {
      type: 'ORDER_CREATED';
      orderType: string;
      orderChannel: string;
      tableIds: string[];
    }
  | { type: 'ORDER_ITEM_ADDED' }
  | { type: 'ORDER_ITEM_REMOVED' }
  | { type: 'ORDER_ROUND_SENT'; itemCount: number }
  | { type: 'ORDER_TABLES_UPDATED'; tableIds: string[] }
  | { type: 'ORDER_PAYMENT_REQUESTED'; paymentRequestedAt: Date }
  | { type: 'ORDER_CLOSED' }
  | { type: 'ORDER_CANCELLED' }
  | {
      type: 'PAYMENT_COMPLETED';
      paymentId: string;
      cashSessionId: string;
      method: string;
      amountApplied: number;
      tipAmount: number;
      currency: string;
    }
  | { type: 'PAYMENT_VOIDED'; paymentId: string }
  | {
      type: 'CASH_SESSION_OPENED';
      cashSessionId: string;
      cashRegisterId: string;
      openingFloatAmount: number;
      currency: string;
      businessDate: string;
    }
  | {
      type: 'CASH_MOVEMENT_CREATED';
      cashMovementId: string;
      cashSessionId: string;
      movementType: 'CASH_IN' | 'CASH_OUT';
      amount: number;
      currency: string;
      reason: string;
      actorUserId: string;
    }
  | {
      type: 'CASH_SESSION_CLOSED';
      cashSessionId: string;
      businessDate: string;
      expectedCashAmount: number;
      countedCashAmount: number;
      differenceAmount: number;
      currency: string;
      closedBy: string;
    };

export class ProjectionDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionDependencyError';
  }
}

export class ProjectionLeaseLostError extends Error {
  constructor(eventId: string) {
    super(`Projection lease for event ${eventId} is no longer owned by this worker.`);
    this.name = 'ProjectionLeaseLostError';
  }
}

export class CloudProjectionRepository {
  constructor(private readonly pool: Pool) {}

  async claimEvents(input: {
    projectionName?: string;
    projectionVersion: number;
    workerId: string;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ClaimedCloudEvent[]> {
    const projectionName = input.projectionName ?? OPERATIONAL_PROJECTION_NAME;
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        event_id: string;
        schema_version: number;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        aggregate_version: number | null;
        tenant_id: string;
        location_id: string;
        edge_id: string;
        local_sequence: number;
        payload: Record<string, unknown>;
        occurred_at: Date;
        processing_attempt_count: number;
      }>(
        `WITH candidates AS (
           SELECT inbox.event_id
           FROM cloud_sync_inbox inbox
           WHERE NOT EXISTS (
             SELECT 1
             FROM cloud_projection_event_receipts receipt
             WHERE receipt.projection_name = $1
               AND receipt.projection_version = $2
               AND receipt.event_id = inbox.event_id
           )
             AND (inbox.processing_lease_expires_at IS NULL OR inbox.processing_lease_expires_at <= $3)
             AND (inbox.processing_next_attempt_at IS NULL OR inbox.processing_next_attempt_at <= $3)
             AND NOT EXISTS (
               SELECT 1
               FROM cloud_sync_inbox earlier
               WHERE earlier.edge_id = inbox.edge_id
                 AND earlier.local_sequence < inbox.local_sequence
                 AND NOT EXISTS (
                   SELECT 1
                   FROM cloud_projection_event_receipts earlier_receipt
                   WHERE earlier_receipt.projection_name = $1
                     AND earlier_receipt.projection_version = $2
                     AND earlier_receipt.event_id = earlier.event_id
                 )
             )
           ORDER BY inbox.edge_id, inbox.local_sequence
           FOR UPDATE OF inbox SKIP LOCKED
           LIMIT $4
         )
         UPDATE cloud_sync_inbox inbox
         SET processing_status = 'PROCESSING',
             processing_projection_name = $1,
             processing_projection_version = $2,
             processing_owner = $5,
             processing_started_at = $3,
             processing_lease_expires_at = $6,
             processing_next_attempt_at = NULL,
             processing_attempt_count = CASE
               WHEN inbox.processing_projection_name = $1
                 AND inbox.processing_projection_version = $2
                 THEN inbox.processing_attempt_count + 1
               ELSE 1
             END,
             processing_last_error = NULL
         FROM candidates
         WHERE inbox.event_id = candidates.event_id
         RETURNING inbox.*`,
        [projectionName, input.projectionVersion, now, input.limit, input.workerId, leaseExpiresAt],
      );
      await client.query('COMMIT');
      return result.rows.map((row) => ({
        eventId: row.event_id,
        schemaVersion: row.schema_version,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        tenantId: row.tenant_id,
        locationId: row.location_id,
        edgeId: row.edge_id,
        localSequence: row.local_sequence,
        payload: row.payload,
        occurredAt: row.occurred_at,
        processingAttemptCount: row.processing_attempt_count,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeEvent(input: {
    event: ClaimedCloudEvent;
    workerId: string;
    projectionName?: string;
    projectionVersion: number;
    action: ProjectionAction;
    outcome?: Exclude<ProjectionOutcome, 'DEAD_LETTER'>;
    now?: Date;
  }): Promise<void> {
    const client = await this.pool.connect();
    const now = input.now ?? new Date();
    const projectionName = input.projectionName ?? OPERATIONAL_PROJECTION_NAME;
    try {
      await client.query('BEGIN');
      await this.assertLease(client, input.event.eventId, input.workerId);
      await this.applyAction(
        client,
        input.event,
        projectionName,
        input.projectionVersion,
        input.action,
        now,
      );
      await this.recordTerminalOutcome(client, {
        event: input.event,
        projectionName,
        projectionVersion: input.projectionVersion,
        outcome: input.outcome ?? 'PROCESSED',
        degraded: false,
        now,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failEvent(input: {
    event: ClaimedCloudEvent;
    workerId: string;
    projectionName?: string;
    projectionVersion: number;
    error: string;
    maxAttempts: number;
    retryDelayMs: number;
    now?: Date;
  }): Promise<'RETRY' | 'DEAD_LETTER'> {
    const client = await this.pool.connect();
    const now = input.now ?? new Date();
    const projectionName = input.projectionName ?? OPERATIONAL_PROJECTION_NAME;
    try {
      await client.query('BEGIN');
      await this.assertLease(client, input.event.eventId, input.workerId);
      if (input.event.processingAttemptCount >= input.maxAttempts) {
        await this.recordTerminalOutcome(client, {
          event: input.event,
          projectionName,
          projectionVersion: input.projectionVersion,
          outcome: 'DEAD_LETTER',
          degraded: true,
          now,
          error: input.error,
        });
        await client.query('COMMIT');
        return 'DEAD_LETTER';
      }
      await client.query(
        `UPDATE cloud_sync_inbox
         SET processing_status = 'RETRY',
             processing_owner = NULL,
             processing_started_at = NULL,
             processing_lease_expires_at = NULL,
             processing_next_attempt_at = $3,
             processing_last_error = $4
         WHERE event_id = $1 AND processing_owner = $2`,
        [
          input.event.eventId,
          input.workerId,
          new Date(now.getTime() + input.retryDelayMs),
          input.error.slice(0, 2_000),
        ],
      );
      await client.query('COMMIT');
      return 'RETRY';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async countUnprocessed(
    projectionVersion: number,
    projectionName = OPERATIONAL_PROJECTION_NAME,
  ): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM cloud_sync_inbox inbox
       WHERE NOT EXISTS (
         SELECT 1 FROM cloud_projection_event_receipts receipt
         WHERE receipt.projection_name = $1
           AND receipt.projection_version = $2
           AND receipt.event_id = inbox.event_id
       )`,
      [projectionName, projectionVersion],
    );
    return result.rows[0]?.count ?? 0;
  }

  async resetProjectionVersion(
    projectionVersion: number,
    projectionName = OPERATIONAL_PROJECTION_NAME,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of [
        'cloud_cash_movements',
        'cloud_cash_session_summaries',
        'cloud_closed_sale_summaries',
        'cloud_payment_summaries',
        'cloud_order_operational_summaries',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE projection_version = $1`, [
          projectionVersion,
        ]);
      }
      await client.query(
        `DELETE FROM cloud_projection_event_receipts
         WHERE projection_name = $1 AND projection_version = $2`,
        [projectionName, projectionVersion],
      );
      await client.query(
        `DELETE FROM cloud_projection_checkpoints
         WHERE projection_name = $1 AND projection_version = $2`,
        [projectionName, projectionVersion],
      );
      await client.query(
        `UPDATE cloud_sync_inbox
         SET processing_status = 'RECEIVED',
             processing_attempt_count = 0,
             processing_owner = NULL,
             processing_started_at = NULL,
             processing_lease_expires_at = NULL,
             processing_next_attempt_at = NULL,
             processed_at = NULL,
             processing_last_error = NULL
         WHERE processing_projection_name = $1 AND processing_projection_version = $2`,
        [projectionName, projectionVersion],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertLease(client: PoolClient, eventId: string, workerId: string): Promise<void> {
    const result = await client.query<{ processing_owner: string | null }>(
      'SELECT processing_owner FROM cloud_sync_inbox WHERE event_id = $1 FOR UPDATE',
      [eventId],
    );
    if (result.rows[0]?.processing_owner !== workerId) throw new ProjectionLeaseLostError(eventId);
  }

  private async recordTerminalOutcome(
    client: PoolClient,
    input: {
      event: ClaimedCloudEvent;
      projectionName: string;
      projectionVersion: number;
      outcome: ProjectionOutcome;
      degraded: boolean;
      now: Date;
      error?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO cloud_projection_event_receipts
         (projection_name, projection_version, event_id, edge_id, local_sequence, outcome, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (projection_name, projection_version, event_id) DO NOTHING`,
      [
        input.projectionName,
        input.projectionVersion,
        input.event.eventId,
        input.event.edgeId,
        input.event.localSequence,
        input.outcome,
        input.now,
      ],
    );
    await client.query(
      `INSERT INTO cloud_projection_checkpoints
         (projection_name, projection_version, edge_id, last_local_sequence, last_event_id, degraded, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (projection_name, projection_version, edge_id)
       DO UPDATE SET
         last_local_sequence = GREATEST(cloud_projection_checkpoints.last_local_sequence, EXCLUDED.last_local_sequence),
         last_event_id = CASE
           WHEN EXCLUDED.last_local_sequence >= cloud_projection_checkpoints.last_local_sequence
             THEN EXCLUDED.last_event_id
           ELSE cloud_projection_checkpoints.last_event_id
         END,
         degraded = cloud_projection_checkpoints.degraded OR EXCLUDED.degraded,
         updated_at = EXCLUDED.updated_at`,
      [
        input.projectionName,
        input.projectionVersion,
        input.event.edgeId,
        input.event.localSequence,
        input.event.eventId,
        input.degraded,
        input.now,
      ],
    );
    await client.query(
      `UPDATE cloud_sync_inbox
       SET processing_status = $2,
           processing_owner = NULL,
           processing_started_at = NULL,
           processing_lease_expires_at = NULL,
           processing_next_attempt_at = NULL,
           processed_at = $3,
           processing_last_error = $4
       WHERE event_id = $1`,
      [input.event.eventId, input.outcome, input.now, input.error?.slice(0, 2_000) ?? null],
    );
  }

  private async applyAction(
    client: PoolClient,
    event: ClaimedCloudEvent,
    projectionName: string,
    version: number,
    action: ProjectionAction,
    now: Date,
  ): Promise<void> {
    const context: EventContext = event;
    switch (action.type) {
      case 'NOOP':
        return;
      case 'ORDER_CREATED':
        if (
          (
            await client.query(
              `INSERT INTO cloud_order_operational_summaries
             (projection_version, order_id, tenant_id, location_id, edge_id, order_type,
              order_channel, status, table_ids, created_at, last_event_id,
              last_local_sequence, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8::jsonb,$9,$10,$11,$12)
           ON CONFLICT (projection_version, order_id) DO NOTHING`,
              [
                version,
                event.aggregateId,
                event.tenantId,
                event.locationId,
                event.edgeId,
                action.orderType,
                action.orderChannel,
                JSON.stringify(action.tableIds),
                event.occurredAt,
                event.eventId,
                event.localSequence,
                now,
              ],
            )
          ).rowCount !== 1
        ) {
          throw new ProjectionDependencyError(
            `Order ${event.aggregateId} already has a projected creation.`,
          );
        }
        return;
      case 'ORDER_ITEM_ADDED':
        await this.updateOrder(client, context, version, now, 'item_count = item_count + 1');
        return;
      case 'ORDER_ITEM_REMOVED':
        await this.updateOrder(
          client,
          context,
          version,
          now,
          'item_count = GREATEST(item_count - 1, 0)',
        );
        return;
      case 'ORDER_ROUND_SENT':
        await this.updateOrder(
          client,
          context,
          version,
          now,
          'sent_item_count = sent_item_count + $6',
          [action.itemCount],
        );
        return;
      case 'ORDER_TABLES_UPDATED':
        await this.updateOrder(client, context, version, now, 'table_ids = $6::jsonb', [
          JSON.stringify(action.tableIds),
        ]);
        return;
      case 'ORDER_PAYMENT_REQUESTED':
        await this.updateOrder(client, context, version, now, 'payment_requested_at = $6', [
          action.paymentRequestedAt,
        ]);
        return;
      case 'ORDER_CANCELLED':
        await this.updateOrder(
          client,
          context,
          version,
          now,
          "status = 'CANCELLED', cancelled_at = $6",
          [event.occurredAt],
        );
        return;
      case 'PAYMENT_COMPLETED':
        await this.completePayment(client, event, version, action, now);
        return;
      case 'PAYMENT_VOIDED':
        await this.voidPayment(client, event, version, action.paymentId, now);
        return;
      case 'ORDER_CLOSED':
        await this.closeOrder(client, event, projectionName, version, now);
        return;
      case 'CASH_SESSION_OPENED':
        if (
          (
            await client.query(
              `INSERT INTO cloud_cash_session_summaries
             (projection_version, cash_session_id, cash_register_id, tenant_id, location_id,
              edge_id, business_date, currency, status, opening_float_amount, opened_at,
              last_event_id, last_local_sequence, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10,$11,$12,$13)
           ON CONFLICT (projection_version, cash_session_id) DO NOTHING`,
              [
                version,
                action.cashSessionId,
                action.cashRegisterId,
                event.tenantId,
                event.locationId,
                event.edgeId,
                action.businessDate,
                action.currency,
                action.openingFloatAmount,
                event.occurredAt,
                event.eventId,
                event.localSequence,
                now,
              ],
            )
          ).rowCount !== 1
        ) {
          throw new ProjectionDependencyError(
            `CashSession ${action.cashSessionId} already has a projected opening.`,
          );
        }
        return;
      case 'CASH_MOVEMENT_CREATED':
        await this.createCashMovement(client, event, version, action, now);
        return;
      case 'CASH_SESSION_CLOSED':
        await this.closeCashSession(client, event, version, action, now);
    }
  }

  private async updateOrder(
    client: PoolClient,
    event: EventContext,
    version: number,
    now: Date,
    mutationSql: string,
    values: unknown[] = [],
  ): Promise<void> {
    const tenantParameter = 6 + values.length;
    const locationParameter = tenantParameter + 1;
    const edgeParameter = tenantParameter + 2;
    const result = await client.query(
      `UPDATE cloud_order_operational_summaries
       SET ${mutationSql}, last_event_id = $3, last_local_sequence = $4, updated_at = $5
       WHERE projection_version = $1 AND order_id = $2
         AND tenant_id = $${tenantParameter}
         AND location_id = $${locationParameter}
         AND edge_id = $${edgeParameter}`,
      [
        version,
        event.aggregateId,
        event.eventId,
        event.localSequence,
        now,
        ...values,
        event.tenantId,
        event.locationId,
        event.edgeId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new ProjectionDependencyError(`Order ${event.aggregateId} has no projected creation.`);
    }
  }

  private async completePayment(
    client: PoolClient,
    event: ClaimedCloudEvent,
    version: number,
    action: Extract<ProjectionAction, { type: 'PAYMENT_COMPLETED' }>,
    now: Date,
  ): Promise<void> {
    const order = await client.query(
      `SELECT 1 FROM cloud_order_operational_summaries
       WHERE projection_version = $1 AND order_id = $2
         AND tenant_id = $3 AND location_id = $4 AND edge_id = $5`,
      [version, event.aggregateId, event.tenantId, event.locationId, event.edgeId],
    );
    if (order.rowCount !== 1) {
      throw new ProjectionDependencyError(`Payment ${action.paymentId} has no projected Order.`);
    }
    const inserted = await client.query(
      `INSERT INTO cloud_payment_summaries
         (projection_version, payment_id, order_id, cash_session_id, tenant_id, location_id,
          edge_id, method, amount_applied, tip_amount, currency, status, completed_at,
          last_event_id, last_local_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'COMPLETED',$12,$13,$14)
       ON CONFLICT (projection_version, payment_id) DO NOTHING`,
      [
        version,
        action.paymentId,
        event.aggregateId,
        action.cashSessionId,
        event.tenantId,
        event.locationId,
        event.edgeId,
        action.method,
        action.amountApplied,
        action.tipAmount,
        action.currency,
        event.occurredAt,
        event.eventId,
        event.localSequence,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new ProjectionDependencyError(
        `Payment ${action.paymentId} already has a projected completion.`,
      );
    }
    await this.updateOrder(
      client,
      event,
      version,
      now,
      'paid_amount = paid_amount + $6, tip_amount = tip_amount + $7, currency = COALESCE(currency, $8)',
      [action.amountApplied, action.tipAmount, action.currency],
    );
  }

  private async voidPayment(
    client: PoolClient,
    event: ClaimedCloudEvent,
    version: number,
    paymentId: string,
    now: Date,
  ): Promise<void> {
    const payment = await client.query<{ amount_applied: string; tip_amount: string }>(
      `UPDATE cloud_payment_summaries
       SET status = 'VOIDED', voided_at = $3, last_event_id = $4, last_local_sequence = $5
       WHERE projection_version = $1 AND payment_id = $2 AND status = 'COMPLETED'
         AND order_id = $6 AND tenant_id = $7 AND location_id = $8 AND edge_id = $9
       RETURNING amount_applied, tip_amount`,
      [
        version,
        paymentId,
        event.occurredAt,
        event.eventId,
        event.localSequence,
        event.aggregateId,
        event.tenantId,
        event.locationId,
        event.edgeId,
      ],
    );
    const row = payment.rows[0];
    if (!row)
      throw new ProjectionDependencyError(`Payment ${paymentId} is not projected COMPLETED.`);
    await this.updateOrder(
      client,
      event,
      version,
      now,
      'paid_amount = paid_amount - $6, tip_amount = tip_amount - $7',
      [Number(row.amount_applied), Number(row.tip_amount)],
    );
  }

  private async closeOrder(
    client: PoolClient,
    event: ClaimedCloudEvent,
    projectionName: string,
    version: number,
    now: Date,
  ): Promise<void> {
    await this.updateOrder(client, event, version, now, "status = 'CLOSED', closed_at = $6", [
      event.occurredAt,
    ]);
    const totals = await client.query<{
      sale_amount: string;
      tip_amount: string;
      currency: string | null;
    }>(
      `SELECT COALESCE(sum(amount_applied), 0)::text AS sale_amount,
              COALESCE(sum(tip_amount), 0)::text AS tip_amount,
              min(currency) AS currency
       FROM cloud_payment_summaries
       WHERE projection_version = $1 AND order_id = $2 AND status = 'COMPLETED'
         AND tenant_id = $3 AND location_id = $4 AND edge_id = $5`,
      [version, event.aggregateId, event.tenantId, event.locationId, event.edgeId],
    );
    const poison = await client.query(
      `SELECT 1
       FROM cloud_projection_event_receipts receipt
       JOIN cloud_sync_inbox inbox ON inbox.event_id = receipt.event_id
       WHERE receipt.projection_name = $1
         AND receipt.projection_version = $2
         AND receipt.outcome IN ('DEAD_LETTER', 'SKIPPED_UNHANDLED')
         AND inbox.aggregate_id = $3
         AND inbox.local_sequence < $4
         AND inbox.tenant_id = $5
         AND inbox.location_id = $6
         AND inbox.edge_id = $7
       LIMIT 1`,
      [
        projectionName,
        version,
        event.aggregateId,
        event.localSequence,
        event.tenantId,
        event.locationId,
        event.edgeId,
      ],
    );
    const saleAmount = Number(totals.rows[0]?.sale_amount ?? 0);
    const tipAmount = Number(totals.rows[0]?.tip_amount ?? 0);
    await client.query(
      `INSERT INTO cloud_closed_sale_summaries
         (projection_version, order_id, tenant_id, location_id, edge_id, sale_amount,
          tip_amount, charged_total, currency, completeness_status, closed_at,
          source_event_id, last_local_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (projection_version, order_id) DO UPDATE SET
         sale_amount = EXCLUDED.sale_amount,
         tip_amount = EXCLUDED.tip_amount,
         charged_total = EXCLUDED.charged_total,
         currency = EXCLUDED.currency,
         completeness_status = EXCLUDED.completeness_status,
         closed_at = EXCLUDED.closed_at,
         source_event_id = EXCLUDED.source_event_id,
         last_local_sequence = EXCLUDED.last_local_sequence`,
      [
        version,
        event.aggregateId,
        event.tenantId,
        event.locationId,
        event.edgeId,
        saleAmount,
        tipAmount,
        saleAmount + tipAmount,
        totals.rows[0]?.currency ?? null,
        poison.rowCount === 0 ? 'COMPLETE' : 'INCOMPLETE',
        event.occurredAt,
        event.eventId,
        event.localSequence,
      ],
    );
  }

  private async createCashMovement(
    client: PoolClient,
    event: ClaimedCloudEvent,
    version: number,
    action: Extract<ProjectionAction, { type: 'CASH_MOVEMENT_CREATED' }>,
    now: Date,
  ): Promise<void> {
    const inserted = await client.query(
      `INSERT INTO cloud_cash_movements
         (projection_version, cash_movement_id, cash_session_id, tenant_id, location_id,
          edge_id, movement_type, amount, currency, reason, actor_user_id, occurred_at,
          source_event_id, local_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (projection_version, cash_movement_id) DO NOTHING`,
      [
        version,
        action.cashMovementId,
        action.cashSessionId,
        event.tenantId,
        event.locationId,
        event.edgeId,
        action.movementType,
        action.amount,
        action.currency,
        action.reason,
        action.actorUserId,
        event.occurredAt,
        event.eventId,
        event.localSequence,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new ProjectionDependencyError(
        `Cash movement ${action.cashMovementId} already has a projected creation.`,
      );
    }
    const column = action.movementType === 'CASH_IN' ? 'cash_in_amount' : 'cash_out_amount';
    const result = await client.query(
      `UPDATE cloud_cash_session_summaries
       SET ${column} = ${column} + $3,
           last_event_id = $4, last_local_sequence = $5, updated_at = $6
       WHERE projection_version = $1 AND cash_session_id = $2
         AND tenant_id = $7 AND location_id = $8 AND edge_id = $9`,
      [
        version,
        action.cashSessionId,
        action.amount,
        event.eventId,
        event.localSequence,
        now,
        event.tenantId,
        event.locationId,
        event.edgeId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new ProjectionDependencyError(
        `Cash movement ${action.cashMovementId} has no projected CashSession.`,
      );
    }
  }

  private async closeCashSession(
    client: PoolClient,
    event: ClaimedCloudEvent,
    version: number,
    action: Extract<ProjectionAction, { type: 'CASH_SESSION_CLOSED' }>,
    now: Date,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE cloud_cash_session_summaries
       SET status = 'CLOSED', business_date = $3, currency = $4,
           expected_cash_amount = $5, counted_cash_amount = $6, difference_amount = $7,
           closed_at = $8, closed_by = $9, last_event_id = $10,
           last_local_sequence = $11, updated_at = $12
       WHERE projection_version = $1 AND cash_session_id = $2
         AND tenant_id = $13 AND location_id = $14 AND edge_id = $15`,
      [
        version,
        action.cashSessionId,
        action.businessDate,
        action.currency,
        action.expectedCashAmount,
        action.countedCashAmount,
        action.differenceAmount,
        event.occurredAt,
        action.closedBy,
        event.eventId,
        event.localSequence,
        now,
        event.tenantId,
        event.locationId,
        event.edgeId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new ProjectionDependencyError(
        `CashSession ${action.cashSessionId} has no projected opening.`,
      );
    }
  }
}
