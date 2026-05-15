CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked BOOLEAN DEFAULT FALSE,
  last_used_at TIMESTAMPTZ
);

CREATE TABLE rbac_policies (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL,
  tool_pattern TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rbac_caller ON rbac_policies(caller_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  server TEXT NOT NULL,
  method TEXT NOT NULL,
  args_hash TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE INDEX idx_audit_caller ON audit_log(caller_id, recorded_at DESC);
CREATE INDEX idx_audit_tool ON audit_log(tool, recorded_at DESC);
