-- Migration 006: Add client_id FK to kep_credentials + unique active-KEP-per-client constraint
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. client_id column (nullable — existing rows have none yet;
--    will be filled by backfill-kep-credentials.mjs, then
--    enforced NOT NULL in migration 008 after backfill verified)
-- ============================================================

alter table kep_credentials
  add column if not exists client_id uuid references clients(id) on delete cascade;

-- ============================================================
-- 2. Index for fast lookup by client_id
-- ============================================================

create index if not exists kep_credentials_client_id_idx
  on kep_credentials (client_id)
  where client_id is not null;

-- ============================================================
-- 3. Partial unique index: one active KEP per client
--
--    Enforces at the DB level that a given client has at most
--    one is_active=true row. Certificate renewal must deactivate
--    the old row before inserting a new one.
-- ============================================================

create unique index if not exists kep_credentials_one_active_per_client
  on kep_credentials (client_id)
  where is_active = true and client_id is not null;
