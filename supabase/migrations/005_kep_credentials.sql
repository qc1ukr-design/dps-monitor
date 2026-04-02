-- Migration 005: KEP credentials storage with KMS encryption + access audit log
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. kep_credentials
-- ============================================================

create table if not exists kep_credentials (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  -- Metadata (plain text — no sensitive info)
  client_name           text not null,
  edrpou                text not null,
  file_name             text,
  file_size             integer,
  is_active             boolean not null default true,
  last_used_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Encrypted payload (KMS envelope, stored separately for key rotation flexibility)
  encrypted_kep_blob    text not null,       -- base64 AES-256-GCM ciphertext of KEP file
  encrypted_password_blob text not null,     -- base64 AES-256-GCM ciphertext of KEP password
  encrypted_dek         text not null,       -- base64 DEK encrypted by KMS CMK
  kms_key_id            text not null        -- ARN of the KMS CMK used to wrap DEK
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists kep_credentials_user_id_idx
  on kep_credentials (user_id);

create index if not exists kep_credentials_user_active_idx
  on kep_credentials (user_id, is_active)
  where is_active = true;

-- ============================================================
-- updated_at auto-maintenance
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger kep_credentials_updated_at
  before update on kep_credentials
  for each row
  execute function set_updated_at();

-- ============================================================
-- Row Level Security — kep_credentials
-- ============================================================

alter table kep_credentials enable row level security;

create policy "kep_credentials: owner select"
  on kep_credentials
  for select
  using (auth.uid() = user_id);

create policy "kep_credentials: owner insert"
  on kep_credentials
  for insert
  with check (auth.uid() = user_id);

create policy "kep_credentials: owner update"
  on kep_credentials
  for update
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "kep_credentials: owner delete"
  on kep_credentials
  for delete
  using (auth.uid() = user_id);

-- ============================================================
-- 2. kep_access_log
-- ============================================================

create table if not exists kep_access_log (
  id            uuid primary key default gen_random_uuid(),
  kep_id        uuid references kep_credentials(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,

  -- Action type: UPLOAD | USE_FOR_DPS | DELETE | VIEW_LIST
  action        text not null check (action in ('UPLOAD', 'USE_FOR_DPS', 'DELETE', 'VIEW_LIST')),

  -- Request context
  ip_address    text,
  user_agent    text,

  -- Result
  success       boolean not null,
  error_message text,

  created_at    timestamptz not null default now()
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists kep_access_log_kep_id_idx
  on kep_access_log (kep_id);

create index if not exists kep_access_log_user_id_idx
  on kep_access_log (user_id);

create index if not exists kep_access_log_created_at_idx
  on kep_access_log (created_at desc);

-- ============================================================
-- Row Level Security — kep_access_log
-- ============================================================

alter table kep_access_log enable row level security;

-- Authenticated users can append their own log entries
create policy "kep_access_log: authenticated insert"
  on kep_access_log
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- SELECT is blocked for all non-service roles.
-- Backend (Railway, service_role key) bypasses RLS → reads freely.
-- No explicit SELECT policy = no access for anon/authenticated roles.
