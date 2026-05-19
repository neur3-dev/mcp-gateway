-- Rename args_hash → args_record (idempotent).
-- The column stores either a SHA-256 hash (redact_args=true) or truncated raw JSON (redact_args=false).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'args_hash'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN args_hash TO args_record;
  END IF;
END $$;
