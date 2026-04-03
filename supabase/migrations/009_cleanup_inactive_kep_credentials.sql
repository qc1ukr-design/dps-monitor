-- Migration 009: Auto-cleanup of inactive KEP credentials via pg_cron
--
-- Security rationale: rows with is_active = false are no longer used for signing.
-- Retaining them indefinitely increases the blast radius of a database breach —
-- an attacker with DB access + a compromised KMS key could decrypt historical blobs.
-- Deleting after 30 days minimises that window while allowing rollback time if needed.
--
-- How to apply:
--   1. Enable the pg_cron extension in Supabase Dashboard → Database → Extensions
--   2. Run this SQL in Supabase SQL Editor
--
-- To verify the job was registered:
--   SELECT * FROM cron.job WHERE jobname = 'cleanup-inactive-kep-credentials';
--
-- To manually trigger a cleanup run (for testing):
--   DELETE FROM kep_credentials
--   WHERE is_active = false AND updated_at < NOW() - INTERVAL '30 days';

-- Enable pg_cron (idempotent — safe to run even if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove old job if it exists (makes migration re-runnable)
SELECT cron.unschedule('cleanup-inactive-kep-credentials')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-inactive-kep-credentials'
);

-- Schedule daily cleanup at 03:00 UTC
-- Deletes KEP rows that have been inactive for more than 30 days.
-- The audit log is preserved — kep_access_log.kep_id has ON DELETE SET NULL.
SELECT cron.schedule(
  'cleanup-inactive-kep-credentials',
  '0 3 * * *',
  $$
    DELETE FROM kep_credentials
    WHERE is_active = false
      AND updated_at < NOW() - INTERVAL '30 days';
  $$
);
