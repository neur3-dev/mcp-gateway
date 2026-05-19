-- Rename args_hash → args_record.
-- The column stores either a SHA-256 hash (redact_args=true) or truncated raw JSON (redact_args=false).
-- The old name was misleading when raw JSON was stored.
ALTER TABLE audit_log RENAME COLUMN args_hash TO args_record;
