-- Add is_archived flag to clients
-- Run once in Supabase SQL Editor
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;
