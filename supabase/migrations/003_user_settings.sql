-- User notification settings (Telegram, email preferences)
-- Run this in Supabase SQL Editor

create table if not exists user_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id     text,
  notify_telegram      boolean not null default false,
  updated_at           timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "Users manage own settings"
  on user_settings for all using (auth.uid() = user_id);

-- Alerts table (if not yet created)
create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  type        text not null,
  message     text not null,
  data        jsonb,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table alerts enable row level security;

create policy if not exists "Users manage own alerts"
  on alerts for all using (auth.uid() = user_id);
