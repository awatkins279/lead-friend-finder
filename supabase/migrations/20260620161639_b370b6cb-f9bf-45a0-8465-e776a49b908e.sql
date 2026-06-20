
create table if not exists public.voicemail_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  segments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.voicemail_templates to authenticated;
grant all on public.voicemail_templates to service_role;

alter table public.voicemail_templates enable row level security;

create policy "Users manage own voicemail templates" on public.voicemail_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists voicemail_templates_user_idx on public.voicemail_templates(user_id);

drop trigger if exists voicemail_templates_touch on public.voicemail_templates;
create trigger voicemail_templates_touch before update on public.voicemail_templates
  for each row execute function public.set_updated_at_timestamp();

create policy "Users read own vm variable clips" on storage.objects for select
  using (bucket_id = 'voicemail-variable-clips' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users write own vm variable clips" on storage.objects for insert
  with check (bucket_id = 'voicemail-variable-clips' and auth.uid()::text = (storage.foldername(name))[1]);
