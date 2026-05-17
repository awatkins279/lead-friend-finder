
create extension if not exists pg_trgm;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.leads (
  id text primary key,
  first_name text,
  last_name text,
  email text,
  validation_status text,
  linkedin_url text,
  title text,
  profile_pic text,
  city text,
  state text,
  country text,
  phone text,
  org_name text,
  org_description text,
  org_website_url text,
  org_industry text,
  org_annual_revenue text,
  org_employee_count text,
  org_technologies_used text,
  hubspot_status text,
  hubspot_sync_date text,
  created_at timestamptz not null default now()
);

create index leads_title_trgm on public.leads using gin (title gin_trgm_ops);
create index leads_org_name_trgm on public.leads using gin (org_name gin_trgm_ops);
create index leads_first_name_trgm on public.leads using gin (first_name gin_trgm_ops);
create index leads_last_name_trgm on public.leads using gin (last_name gin_trgm_ops);
create index leads_city_idx on public.leads (lower(city));
create index leads_state_idx on public.leads (lower(state));
create index leads_country_idx on public.leads (lower(country));
create index leads_industry_idx on public.leads (lower(org_industry));

alter table public.leads enable row level security;
create policy "Authenticated can read leads" on public.leads for select to authenticated using (true);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.saved_searches enable row level security;
create policy "Users manage own saved searches"
  on public.saved_searches for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
