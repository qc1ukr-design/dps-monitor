-- Migration: Add KEP fields to api_tokens (run if table already exists without these columns)

alter table api_tokens
  add column if not exists kep_encrypted          text,
  add column if not exists kep_password_encrypted text,
  add column if not exists kep_ca_name            text,
  add column if not exists kep_owner_name         text,
  add column if not exists kep_valid_to           timestamptz,
  add column if not exists kep_tax_id             text,
  add column if not exists updated_at             timestamptz not null default now();

-- Migration: Create dps_cache table
create table if not exists dps_cache (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data_type   text not null,
  data        jsonb,
  fetched_at  timestamptz not null default now(),
  is_mock     boolean not null default false,
  unique(client_id, data_type)
);

alter table dps_cache enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'dps_cache' and policyname = 'Users manage own cache'
  ) then
    create policy "Users manage own cache"
      on dps_cache for all using (auth.uid() = user_id);
  end if;
end $$;
