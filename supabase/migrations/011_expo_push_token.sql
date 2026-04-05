-- Migration 011: add expo_push_token to user_settings

-- 1. Add expo_push_token column (nullable, no default)
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- 2. Add comment to the column
COMMENT ON COLUMN user_settings.expo_push_token
    IS 'Expo Push Notification token (реєструється з мобільного застосунку)';

-- 3. Partial index for push delivery queries (WHERE expo_push_token IS NOT NULL)
CREATE INDEX IF NOT EXISTS idx_user_settings_expo_push_token
    ON user_settings (expo_push_token)
    WHERE expo_push_token IS NOT NULL;

-- 4. RLS policy: authenticated user may UPDATE only their own row
--    Drop first if it already exists under this name to keep migration idempotent.
DO $$
BEGIN
    -- Remove the old policy if present (name collision protection)
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'user_settings'
          AND policyname = 'user_settings_update_own'
    ) THEN
        EXECUTE 'DROP POLICY user_settings_update_own ON user_settings';
    END IF;

    -- Create the policy
    EXECUTE $policy$
        CREATE POLICY user_settings_update_own
            ON user_settings
            FOR UPDATE
            TO authenticated
            USING     (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid())
    $policy$;
END;
$$;
