
-- AGENTS
create table public.sdr_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  sdr_display_name text,
  signature text,
  tone text not null default 'consultative',
  formality int not null default 50,
  mode text not null default 'draft',
  response_speed text not null default 'medium',
  confidence_threshold int not null default 80,
  booking_url text,
  hard_rules text,
  handoff_triggers text,
  what_selling text,
  key_differentiators text,
  extra_instructions text,
  inbox_account_id uuid,
  inbox_provider text,
  inbox_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sdr_agents enable row level security;

create policy "Users manage own sdr agents"
on public.sdr_agents for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger sdr_agents_touch
before update on public.sdr_agents
for each row execute function public.touch_updated_at();

create index sdr_agents_user_idx on public.sdr_agents(user_id);

-- KNOWLEDGE DOCS
create table public.sdr_knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.sdr_agents(id) on delete cascade,
  user_id uuid not null,
  filename text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'pending',
  error text,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sdr_knowledge_docs enable row level security;

create policy "Users manage own sdr knowledge docs"
on public.sdr_knowledge_docs for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger sdr_knowledge_docs_touch
before update on public.sdr_knowledge_docs
for each row execute function public.touch_updated_at();

create index sdr_knowledge_docs_agent_idx on public.sdr_knowledge_docs(agent_id);

-- KNOWLEDGE CHUNKS (no embeddings yet — added in next pass)
create table public.sdr_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.sdr_knowledge_docs(id) on delete cascade,
  agent_id uuid not null references public.sdr_agents(id) on delete cascade,
  user_id uuid not null,
  chunk_index int not null,
  content text not null,
  token_count int,
  created_at timestamptz not null default now()
);

alter table public.sdr_knowledge_chunks enable row level security;

create policy "Users read own sdr knowledge chunks"
on public.sdr_knowledge_chunks for select
using (auth.uid() = user_id);

create policy "Users insert own sdr knowledge chunks"
on public.sdr_knowledge_chunks for insert
with check (auth.uid() = user_id);

create policy "Users delete own sdr knowledge chunks"
on public.sdr_knowledge_chunks for delete
using (auth.uid() = user_id);

create index sdr_knowledge_chunks_agent_idx on public.sdr_knowledge_chunks(agent_id);
create index sdr_knowledge_chunks_doc_idx on public.sdr_knowledge_chunks(doc_id);

-- LISTS LINK
alter table public.lists
  add column sdr_agent_id uuid references public.sdr_agents(id) on delete set null,
  add column sdr_mode_override text,
  add column sdr_booking_url_override text,
  add column sdr_hard_rules_override text;

create index lists_sdr_agent_idx on public.lists(sdr_agent_id);

-- STORAGE BUCKET (private)
insert into storage.buckets (id, name, public)
values ('sdr-knowledge', 'sdr-knowledge', false)
on conflict (id) do nothing;

create policy "Users read own sdr knowledge files"
on storage.objects for select
using (
  bucket_id = 'sdr-knowledge'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users upload own sdr knowledge files"
on storage.objects for insert
with check (
  bucket_id = 'sdr-knowledge'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users update own sdr knowledge files"
on storage.objects for update
using (
  bucket_id = 'sdr-knowledge'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users delete own sdr knowledge files"
on storage.objects for delete
using (
  bucket_id = 'sdr-knowledge'
  and auth.uid()::text = (storage.foldername(name))[1]
);
