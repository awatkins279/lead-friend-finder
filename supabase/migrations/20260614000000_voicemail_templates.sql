-- Personalized voicemail templates.
-- A template is an ordered list of segments (jsonb): recorded audio chunks (the
-- rep's real voice, in the voicemail-drops bucket), variable tokens that get
-- spoken per-prospect in the cloned voice, and optional silence padding.

create table if not exists public.voicemail_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  segments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.voicemail_templates enable row level security;

create policy "Users manage own voicemail templates"
  on public.voicemail_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists voicemail_templates_user_idx
  on public.voicemail_templates(user_id);

create trigger voicemail_templates_touch
  before update on public.voicemail_templates
  for each row execute function public.set_updated_at_timestamp();

-- Cache bucket for synthesized variable clips, keyed by {userId}/{voiceId}/{hash}.mp3
-- so a given name/company in a given cloned voice is only ever synthesized once.
insert into storage.buckets (id, name, public)
values ('voicemail-variable-clips', 'voicemail-variable-clips', false)
on conflict (id) do nothing;

create policy "Users read own vm variable clips"
  on storage.objects for select
  using (bucket_id = 'voicemail-variable-clips'
         and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users write own vm variable clips"
  on storage.objects for insert
  with check (bucket_id = 'voicemail-variable-clips'
              and auth.uid()::text = (storage.foldername(name))[1]);
