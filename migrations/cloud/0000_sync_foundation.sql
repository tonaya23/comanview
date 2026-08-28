CREATE TABLE IF NOT EXISTS edges (
  edge_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  credential_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS unq_active_edge_location
  ON edges (location_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS cloud_sync_inbox (
  event_id UUID PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  protocol_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_version INTEGER,
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  edge_id UUID NOT NULL REFERENCES edges(edge_id),
  batch_id UUID NOT NULL,
  local_sequence INTEGER NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_inbox_edge_order
  ON cloud_sync_inbox (edge_id, occurred_at, local_sequence);

CREATE TABLE IF NOT EXISTS edge_heartbeats (
  edge_id UUID PRIMARY KEY REFERENCES edges(edge_id),
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  edge_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  pending_event_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL
);
