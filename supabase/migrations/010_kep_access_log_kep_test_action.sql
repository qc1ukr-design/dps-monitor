-- Migration 010: Add KEP_TEST action to kep_access_log
--
-- Rationale: POST /api/kep/:id/test calls decryptKep() which writes USE_FOR_DPS
-- to the audit log, inflating DPS-authentication statistics. KEP_TEST is a
-- dedicated action so analytics can distinguish test-decrypt from real DPS syncs.
--
-- How to apply: Run in Supabase SQL Editor

-- PostgreSQL CHECK constraints cannot be modified in-place — drop old and re-add.
-- The constraint name is the auto-generated default from migration 005.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'kep_access_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%action%';

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE kep_access_log DROP CONSTRAINT ' || quote_ident(v_constraint);
  END IF;
END$$;

ALTER TABLE kep_access_log
  ADD CONSTRAINT kep_access_log_action_check
  CHECK (action IN ('UPLOAD', 'USE_FOR_DPS', 'DELETE', 'VIEW_LIST', 'KEP_TEST'));
