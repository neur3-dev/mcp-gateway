-- Make key_prefix NOT NULL — run ONLY after all API keys have been rotated.
--
-- Prerequisites: verify no null-prefix rows remain before applying:
--   SELECT id, name, created_at FROM api_keys WHERE key_prefix IS NULL AND revoked = FALSE;
-- If that query returns any rows, wait for those keys to authenticate (backfill happens on
-- first successful auth) or revoke and reissue them before running this migration.
--
-- After this migration is applied, remove the isNull(key_prefix) branch in
-- src/auth/api-keys.ts verifyApiKey() to eliminate the legacy O(n) scan path.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'key_prefix'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE api_keys ALTER COLUMN key_prefix SET NOT NULL;
  END IF;
END $$;
