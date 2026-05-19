-- ============================================================
-- Calling module: per-list config, per-user phone accounts, calls
-- ============================================================

-- 1. Per-list calling config
create table public.list_call_configs (
  list_id uuid primary key references public.lists(id) on delete cascade,
  script_template text,
  tone text not null default 'consultative',
  objectives text,
  objection_notes text,
  personalization_level text not null default 'high',
  record_calls boolean not null default true,
  consent_disclaimer text not null default 'This call may be recorded for quality and training purposes.',
  extra_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.list_call_configs enable row level security;

create policy "Users manage call config in own lists"
on public.list_call_configs for all
using (exists (select 1 from public.lists l where l.id = list_call_configs.list_id and l.user_id = auth.uid()))
with check (exists (select 1 from public.lists l where l.id = list_call_configs.list_id and l.user_id = auth.uid()));

create trigger touch_list_call_configs
before update on public.list_call_configs
for each row execute function public.touch_updated_at();

-- 2. Per-user Twilio phone accounts
create table public.user_phone_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label text not null default 'My phone',
  twilio_account_sid text not null,
  twilio_api_key_sid text not null,
  twilio_api_key_secret text not null,
  twilio_twiml_app_sid text,
  from_number text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_phone_accounts enable row level security;

create policy "Users manage own phone accounts"
on public.user_phone_accounts for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger touch_user_phone_accounts
before update on public.user_phone_accounts
for each row execute function public.touch_updated_at();

create index user_phone_accounts_user_idx on public.user_phone_accounts(user_id);

-- 3. Calls table
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  list_id uuid not null references public.lists(id) on delete cascade,
  lead_id text not null,
  phone_account_id uuid references public.user_phone_accounts(id) on delete set null,
  to_number text not null,
  from_number text,
  twilio_call_sid text unique,
  status text not null default 'initiated',
  duration_sec integer,
  recording_sid text,
  recording_url text,
  recording_duration_sec integer,
  transcript jsonb,
  scorecard jsonb,
  notes text,
  outcome text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.calls enable row level security;

create policy "Users manage own calls"
on public.calls for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger touch_calls
before update on public.calls
for each row execute function public.touch_updated_at();

create index calls_user_list_idx on public.calls(user_id, list_id);
create index calls_lead_idx on public.calls(lead_id);
create index calls_sid_idx on public.calls(twilio_call_sid);

-- 4. Cache generated call script + DNC flag on list_leads
alter table public.list_leads
  add column if not exists call_script jsonb,
  add column if not exists do_not_call boolean not null default false;
