-- Initial schema for DPS Monitor
-- Run this in Supabase SQL Editor

-- Clients table
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  edrpou      text,
  created_at  timestamptz not null default now()
);

alter table clients enable row level security;
create policy "Users manage own clients"
  on clients for all using (auth.uid() = user_id);

-- API tokens table (DPS UUID token + KEP)
create table if not exists api_tokens (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  token_encrypted       text,            -- encrypted DPS UUID token (публічна частина)
  kep_encrypted         text,            -- encrypted KEP .pfx file (base64 of encrypted bytes)
  kep_password_encrypted text,           -- encrypted KEP password
  kep_ca_name           text,            -- АЦСК name (plain text, auto-detected)
  kep_owner_name        text,            -- Certificate owner full name
  kep_valid_to          timestamptz,     -- Certificate expiry date
  kep_tax_id            text,            -- РНОКПП/ЄДРПОУ from certificate
  updated_at            timestamptz not null default now()
);

alter table api_tokens enable row level security;
create policy "Users manage own tokens"
  on api_tokens for all using (auth.uid() = user_id);

-- DPS data cache table
create table if not exists dps_cache (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data_type   text not null,    -- 'profile' | 'budget'
  data        jsonb,
  fetched_at  timestamptz not null default now(),
  is_mock     boolean not null default false,
  unique(client_id, data_type)
);

alter table dps_cache enable row level security;
create policy "Users manage own cache"
  on dps_cache for all using (auth.uid() = user_id);
