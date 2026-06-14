-- Campaign unsubscribe footer + unsubscribe tracking.

-- Per-campaign opt-out footer appended to every generated email.
alter table public.lists
  add column if not exists unsubscribe_footer_enabled boolean not null default true,
  add column if not exists unsubscribe_footer_text text;

-- Tracking table: one row per unsubscribed contact, for counts/analytics.
create table if not exists public.unsubscribes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  lead_email text not null,
  email_account text,
  campaign_name text,
  source text not null default 'instantly',
  unsubscribed_at timestamptz not null default now(),
  unique (user_id, lead_email)
);

alter table public.unsubscribes enable row level security;

create policy "Users manage own unsubscribes"
  on public.unsubscribes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists unsubscribes_user_idx on public.unsubscribes(user_id);
create index if not exists unsubscribes_user_time_idx
  on public.unsubscribes(user_id, unsubscribed_at desc);
