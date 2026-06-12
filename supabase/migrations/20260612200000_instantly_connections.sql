-- Per-user Instantly integration. Stores the user's Instantly API key (RLS-locked
-- so only its owner can ever read it) and bookkeeping about the last mailbox sync.
-- Mirrors the google_calendar_connections per-user credential pattern.

create table if not exists public.instantly_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  api_key text not null,
  workspace_name text,
  status text not null default 'active',
  account_count integer not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.instantly_connections enable row level security;

create policy "Users manage own instantly connection"
  on public.instantly_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger instantly_connections_touch
  before update on public.instantly_connections
  for each row execute function public.set_updated_at_timestamp();
