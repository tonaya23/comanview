BEGIN;

ALTER TABLE cloud_sync_inbox ADD COLUMN recovery_epoch INTEGER NOT NULL DEFAULT 0;
DROP INDEX unq_cloud_sync_inbox_edge_sequence;
CREATE UNIQUE INDEX unq_cloud_sync_inbox_edge_epoch_sequence
  ON cloud_sync_inbox(edge_id,recovery_epoch,local_sequence);
DROP INDEX idx_cloud_sync_inbox_edge_order;
CREATE INDEX idx_cloud_sync_inbox_edge_order
  ON cloud_sync_inbox(edge_id,recovery_epoch,local_sequence);

ALTER TABLE cloud_projection_event_receipts
  ADD COLUMN recovery_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_projection_checkpoints
  ADD COLUMN last_recovery_epoch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cloud_order_operational_summaries ADD COLUMN last_recovery_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_payment_summaries ADD COLUMN last_recovery_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_closed_sale_summaries ADD COLUMN last_recovery_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_cash_session_summaries ADD COLUMN last_recovery_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cloud_cash_movements ADD COLUMN recovery_epoch INTEGER NOT NULL DEFAULT 0;

CREATE TABLE cloud_recovery_authorizations (
  authorization_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  source_edge_id UUID NOT NULL REFERENCES edges(edge_id),
  target_edge_id UUID NOT NULL REFERENCES edges(edge_id),
  backup_id UUID NOT NULL,
  recovery_epoch INTEGER NOT NULL CHECK(recovery_epoch > 0),
  purpose TEXT NOT NULL CHECK(purpose = 'HARDWARE_REPLACEMENT_RESTORE'),
  kid TEXT NOT NULL,
  envelope JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ISSUED','CONSUMED','EXPIRED','REVOKED')),
  command_id UUID NOT NULL UNIQUE,
  issued_by_admin_user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_command_id UUID UNIQUE
);
CREATE UNIQUE INDEX unq_issued_recovery_authorization_target
  ON cloud_recovery_authorizations(target_edge_id) WHERE status='ISSUED';

COMMIT;
