-- Add key_prefix for O(1) lookup before bcrypt compare.
-- Existing keys get NULL; they are backfilled on first successful auth.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT;

-- Partial index: only non-revoked rows with a prefix set.
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys(key_prefix)
  WHERE revoked = FALSE AND key_prefix IS NOT NULL;
