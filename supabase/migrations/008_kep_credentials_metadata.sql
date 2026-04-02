-- Migration 008: KEP certificate metadata + client_id NOT NULL
--
-- Part of Крок D/E migration (kep_credentials full switch):
--
-- 1. Add certificate metadata columns so kep_credentials can fully replace
--    the kep_* fields in api_tokens (ca_name, owner_name, org_name, tax_id, valid_to).
--    These are informational only — never used for crypto operations.
--
-- 2. Enforce client_id NOT NULL now that all 6 clients are backfilled (Крок E).

-- Certificate metadata (optional — NULL for records backfilled before this migration)
ALTER TABLE kep_credentials
  ADD COLUMN IF NOT EXISTS ca_name    TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS org_name   TEXT,
  ADD COLUMN IF NOT EXISTS tax_id     TEXT,
  ADD COLUMN IF NOT EXISTS valid_to   TEXT;   -- ISO-8601 date string or NULL

-- Enforce NOT NULL on client_id — all existing rows already have it set (verified Крок C)
ALTER TABLE kep_credentials
  ALTER COLUMN client_id SET NOT NULL;
