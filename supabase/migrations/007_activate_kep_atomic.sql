-- Migration 007: Atomic KEP activation function
--
-- Replaces two separate non-atomic UPDATEs in activateKep() with a single
-- PostgreSQL function that runs both UPDATEs inside one transaction.
-- This guarantees a client is never left without an active KEP if the second
-- UPDATE would otherwise fail.

CREATE OR REPLACE FUNCTION activate_kep_atomic(
  p_kep_id    uuid,
  p_client_id uuid,   -- NULL → skip deactivating others (first KEP with no client link)
  p_user_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Step 1: Deactivate all currently active KEPs for this client except the new one.
  -- Skipped when p_client_id IS NULL (first upload, nothing to deactivate).
  IF p_client_id IS NOT NULL THEN
    UPDATE kep_credentials
    SET    is_active = false
    WHERE  client_id = p_client_id
      AND  user_id   = p_user_id
      AND  is_active = true
      AND  id       != p_kep_id;
  END IF;

  -- Step 2: Activate the target KEP.
  UPDATE kep_credentials
  SET    is_active = true
  WHERE  id       = p_kep_id
    AND  user_id  = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KEP % not found or not owned by user %', p_kep_id, p_user_id;
  END IF;
END;
$$;

-- Grant EXECUTE to service_role (the backend connects via SUPABASE_SERVICE_ROLE_KEY)
GRANT EXECUTE ON FUNCTION activate_kep_atomic(uuid, uuid, uuid) TO service_role;
