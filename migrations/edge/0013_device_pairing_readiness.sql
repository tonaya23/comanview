PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE devices_new (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('POS','WAITER','KDS')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  session_timeout_minutes INTEGER NOT NULL CHECK (session_timeout_minutes > 0),
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  revoked_at INTEGER
);
INSERT INTO devices_new SELECT id,tenant_id,location_id,name,device_type,status,
  session_timeout_minutes,created_at,CASE WHEN status='ACTIVE' THEN created_at END,NULL FROM devices;
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;

CREATE TABLE device_credentials (
  credential_id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  credential_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(device_id, credential_id)
);
CREATE UNIQUE INDEX unq_active_device_credential ON device_credentials(device_id) WHERE revoked_at IS NULL;

CREATE TABLE device_pairing_requests (
  pairing_id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  edge_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  request_token_hash TEXT NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','EXPIRED','CANCELLED')),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  approved_by_user_id TEXT,
  authorization_id TEXT UNIQUE
);
CREATE INDEX idx_pairing_pending_expiry ON device_pairing_requests(status,expires_at);
CREATE UNIQUE INDEX unq_pending_pairing_device ON device_pairing_requests(device_id) WHERE status='PENDING';

CREATE TABLE installation_state (
  singleton_key TEXT PRIMARY KEY NOT NULL DEFAULT 'PRIMARY',
  bootstrap_status TEXT NOT NULL CHECK(bootstrap_status IN ('PENDING','COMPLETED','DEVICE_RECOVERY_REQUIRED')),
  completed_at INTEGER,
  authorization_id TEXT UNIQUE,
  first_device_id TEXT,
  initial_owner_user_id TEXT,
  cloud_ack_command_id TEXT UNIQUE,
  cloud_acknowledged_at INTEGER,
  cloud_ack_attempt_count INTEGER NOT NULL DEFAULT 0,
  cloud_ack_next_attempt_at INTEGER,
  cloud_ack_last_error TEXT
);
INSERT INTO installation_state(singleton_key,bootstrap_status,completed_at,first_device_id)
SELECT 'PRIMARY',CASE WHEN EXISTS(SELECT 1 FROM devices d JOIN edge_installations e ON e.singleton_key='PRIMARY'
  WHERE d.status='ACTIVE' AND d.tenant_id=e.tenant_id AND d.location_id=e.location_id) THEN 'COMPLETED' ELSE 'PENDING' END,
  CASE WHEN EXISTS(SELECT 1 FROM devices d JOIN edge_installations e ON e.singleton_key='PRIMARY'
    WHERE d.status='ACTIVE' AND d.tenant_id=e.tenant_id AND d.location_id=e.location_id) THEN CAST(strftime('%s','now') AS INTEGER)*1000 END,
  (SELECT d.id FROM devices d JOIN edge_installations e ON e.singleton_key='PRIMARY'
    WHERE d.status='ACTIVE' AND d.tenant_id=e.tenant_id AND d.location_id=e.location_id ORDER BY d.created_at LIMIT 1);

ALTER TABLE audit_log RENAME TO audit_log_old;
CREATE TABLE audit_log (
  audit_id TEXT PRIMARY KEY NOT NULL, occurred_at INTEGER NOT NULL, tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL, device_id TEXT, session_id TEXT, actor_user_id TEXT, actor_role TEXT,
  actor_type TEXT NOT NULL DEFAULT 'USER' CHECK(actor_type IN ('USER','CLOUD_ADMIN_AUTHORIZATION','SYSTEM')),
  authorization_id TEXT, source TEXT, authorized_by_user_id TEXT, authorized_by_role TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','REJECTED')), reason TEXT NOT NULL,
  command_id TEXT, before_json TEXT, after_json TEXT, amount_affected INTEGER, currency TEXT,
  event_id TEXT, previous_hash TEXT, entry_hash TEXT NOT NULL UNIQUE
);
INSERT INTO audit_log(audit_id,occurred_at,tenant_id,location_id,device_id,session_id,actor_user_id,
 actor_role,actor_type,authorized_by_user_id,authorized_by_role,action,entity_type,entity_id,outcome,
 reason,command_id,before_json,after_json,amount_affected,currency,event_id,previous_hash,entry_hash)
SELECT audit_id,occurred_at,tenant_id,location_id,device_id,session_id,actor_user_id,actor_role,'USER',
 authorized_by_user_id,authorized_by_role,action,entity_type,entity_id,outcome,reason,command_id,
 before_json,after_json,amount_affected,currency,event_id,previous_hash,entry_hash FROM audit_log_old;
DROP TABLE audit_log_old;
CREATE UNIQUE INDEX unq_audit_command_action ON audit_log(command_id,action) WHERE command_id IS NOT NULL;
CREATE INDEX idx_audit_recent ON audit_log(location_id,occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id,occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(entity_id,occurred_at DESC);

INSERT OR IGNORE INTO roles(id,name) VALUES
 ('01991a00-0000-7000-8000-000000000701','OWNER'),
 ('01991a00-0000-7000-8000-000000000702','MANAGER'),
 ('01991a00-0000-7000-8000-000000000703','CASHIER'),
 ('01991a00-0000-7000-8000-000000000704','WAITER'),
 ('01991a00-0000-7000-8000-000000000705','KITCHEN');
INSERT OR IGNORE INTO permissions(code,description) VALUES
 ('DEVICE_VIEW','DEVICE_VIEW'),('DEVICE_PAIR','DEVICE_PAIR'),('DEVICE_REVOKE','DEVICE_REVOKE'),
 ('INSTALLATION_READINESS_VIEW','INSTALLATION_READINESS_VIEW');
INSERT OR IGNORE INTO role_permissions(role_id,permission_code)
SELECT id,p.code FROM roles CROSS JOIN
 (SELECT 'DEVICE_VIEW' code UNION ALL SELECT 'DEVICE_PAIR' UNION ALL SELECT 'DEVICE_REVOKE'
  UNION ALL SELECT 'INSTALLATION_READINESS_VIEW') p WHERE roles.name IN ('OWNER','MANAGER');

COMMIT;
PRAGMA foreign_keys = ON;
