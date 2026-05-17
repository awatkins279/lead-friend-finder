
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lists enable row level security;

create policy "Users manage own lists" on public.lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index lists_user_id_idx on public.lists(user_id);

create table public.list_leads (
  list_id uuid not null references public.lists(id) on delete cascade,
  lead_id text not null,
  score int,
  research jsonb,
  email_subject text,
  email_body text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);

alter table public.list_leads enable row level security;

create policy "Users manage list leads in own lists" on public.list_leads
  for all
  using (exists (select 1 from public.lists l where l.id = list_leads.list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_leads.list_id and l.user_id = auth.uid()));

create index list_leads_list_id_idx on public.list_leads(list_id);
create index list_leads_lead_id_idx on public.list_leads(lead_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger lists_touch before update on public.lists
  for each row execute function public.touch_updated_at();

create trigger list_leads_touch before update on public.list_leads
  for each row execute function public.touch_updated_at();
