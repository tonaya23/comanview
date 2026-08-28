ALTER TABLE cloud_sync_inbox
  ADD COLUMN processing_projection_name TEXT,
  ADD COLUMN processing_projection_version INTEGER,
  ADD COLUMN processing_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN processing_owner TEXT,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN processing_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN processing_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN processed_at TIMESTAMPTZ,
  ADD COLUMN processing_last_error TEXT;

CREATE UNIQUE INDEX unq_cloud_sync_inbox_edge_sequence
  ON cloud_sync_inbox (edge_id, local_sequence);

CREATE INDEX idx_cloud_sync_inbox_processing
  ON cloud_sync_inbox (processing_lease_expires_at, processing_next_attempt_at, edge_id, local_sequence);

CREATE TABLE cloud_projection_event_receipts (
  projection_name TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  event_id UUID NOT NULL REFERENCES cloud_sync_inbox(event_id),
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  local_sequence INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (projection_name, projection_version, event_id)
);

CREATE INDEX idx_cloud_projection_receipts_edge_sequence
  ON cloud_projection_event_receipts
  (projection_name, projection_version, edge_id, local_sequence);

CREATE TABLE cloud_projection_checkpoints (
  projection_name TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  last_local_sequence INTEGER NOT NULL,
  last_event_id UUID NOT NULL REFERENCES cloud_sync_inbox(event_id),
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (projection_name, projection_version, edge_id)
);

CREATE TABLE cloud_order_operational_summaries (
  projection_version INTEGER NOT NULL,
  order_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  order_type TEXT NOT NULL,
  order_channel TEXT NOT NULL,
  status TEXT NOT NULL,
  table_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_requested_at TIMESTAMPTZ,
  item_count INTEGER NOT NULL DEFAULT 0,
  sent_item_count INTEGER NOT NULL DEFAULT 0,
  paid_amount BIGINT NOT NULL DEFAULT 0,
  tip_amount BIGINT NOT NULL DEFAULT 0,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_event_id UUID NOT NULL,
  last_local_sequence INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (projection_version, order_id)
);

CREATE INDEX idx_cloud_order_summaries_location_status
  ON cloud_order_operational_summaries (projection_version, location_id, status);

CREATE TABLE cloud_payment_summaries (
  projection_version INTEGER NOT NULL,
  payment_id UUID NOT NULL,
  order_id UUID NOT NULL,
  cash_session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  method TEXT NOT NULL,
  amount_applied BIGINT NOT NULL,
  tip_amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  voided_at TIMESTAMPTZ,
  last_event_id UUID NOT NULL,
  last_local_sequence INTEGER NOT NULL,
  PRIMARY KEY (projection_version, payment_id)
);

CREATE INDEX idx_cloud_payment_summaries_order
  ON cloud_payment_summaries (projection_version, order_id);

CREATE TABLE cloud_closed_sale_summaries (
  projection_version INTEGER NOT NULL,
  order_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  sale_amount BIGINT NOT NULL,
  tip_amount BIGINT NOT NULL,
  charged_total BIGINT NOT NULL,
  currency TEXT,
  completeness_status TEXT NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL,
  source_event_id UUID NOT NULL,
  last_local_sequence INTEGER NOT NULL,
  PRIMARY KEY (projection_version, order_id)
);

CREATE INDEX idx_cloud_closed_sales_location_date
  ON cloud_closed_sale_summaries (projection_version, location_id, closed_at);

CREATE TABLE cloud_cash_session_summaries (
  projection_version INTEGER NOT NULL,
  cash_session_id UUID NOT NULL,
  cash_register_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  business_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  opening_float_amount BIGINT NOT NULL,
  cash_in_amount BIGINT NOT NULL DEFAULT 0,
  cash_out_amount BIGINT NOT NULL DEFAULT 0,
  expected_cash_amount BIGINT,
  counted_cash_amount BIGINT,
  difference_amount BIGINT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  last_event_id UUID NOT NULL,
  last_local_sequence INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (projection_version, cash_session_id)
);

CREATE INDEX idx_cloud_cash_sessions_location_status
  ON cloud_cash_session_summaries (projection_version, location_id, status);

CREATE TABLE cloud_cash_movements (
  projection_version INTEGER NOT NULL,
  cash_movement_id UUID NOT NULL,
  cash_session_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  movement_type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source_event_id UUID NOT NULL,
  local_sequence INTEGER NOT NULL,
  PRIMARY KEY (projection_version, cash_movement_id)
);

CREATE INDEX idx_cloud_cash_movements_session
  ON cloud_cash_movements (projection_version, cash_session_id, occurred_at);
