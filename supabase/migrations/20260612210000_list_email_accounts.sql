-- Per-campaign mailbox pool. A campaign (list) sends from the set of email
-- accounts assigned here; sending rotates across them (B2B-Rocket style). Many
-- mailboxes per campaign, and a mailbox can serve more than one campaign.

create table if not exists public.list_email_accounts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (list_id, email_account_id)
);

alter table public.list_email_accounts enable row level security;

create policy "Users manage own list email accounts"
  on public.list_email_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists list_email_accounts_list_idx
  on public.list_email_accounts(list_id);
create index if not exists list_email_accounts_account_idx
  on public.list_email_accounts(email_account_id);
