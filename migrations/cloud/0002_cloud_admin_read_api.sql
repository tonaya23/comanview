CREATE TABLE cloud_admin_users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cloud_admin_role CHECK (role IN ('PLATFORM_ADMIN_READ', 'SUPPORT_READ')),
  CONSTRAINT chk_cloud_admin_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT chk_cloud_admin_failed_login_count CHECK (failed_login_count >= 0)
);

CREATE UNIQUE INDEX unq_cloud_admin_users_email_normalized
  ON cloud_admin_users (lower(email));

CREATE TABLE cloud_admin_sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX unq_cloud_admin_sessions_token_hash
  ON cloud_admin_sessions (token_hash);

CREATE INDEX idx_cloud_admin_sessions_user_active
  ON cloud_admin_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE cloud_admin_tenant_grants (
  user_id UUID NOT NULL REFERENCES cloud_admin_users(user_id),
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX idx_edges_tenant_location
  ON edges (tenant_id, location_id, edge_id);

CREATE INDEX idx_cloud_orders_scope_keyset
  ON cloud_order_operational_summaries
  (projection_version, tenant_id, location_id, created_at DESC, order_id DESC);

CREATE INDEX idx_cloud_payments_scope_keyset
  ON cloud_payment_summaries
  (projection_version, tenant_id, location_id, completed_at DESC, payment_id DESC);

CREATE INDEX idx_cloud_sales_scope_keyset
  ON cloud_closed_sale_summaries
  (projection_version, tenant_id, location_id, closed_at DESC, order_id DESC);

CREATE INDEX idx_cloud_cash_sessions_scope_keyset
  ON cloud_cash_session_summaries
  (projection_version, tenant_id, location_id, opened_at DESC, cash_session_id DESC);

CREATE INDEX idx_cloud_cash_movements_scope_keyset
  ON cloud_cash_movements
  (projection_version, tenant_id, location_id, cash_session_id, occurred_at DESC, cash_movement_id DESC);

CREATE INDEX idx_cloud_inbox_scope_processing
  ON cloud_sync_inbox
  (tenant_id, location_id, processing_status, received_at);
