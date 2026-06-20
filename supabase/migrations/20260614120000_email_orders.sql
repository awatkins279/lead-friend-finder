-- Done-for-you email-accounts orders (customer pays, admin fulfills).

create table if not exists public.email_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'pending', -- pending -> paid -> in_progress -> completed (or canceled)
  -- Order configuration (TLDs, preferred domains, mailbox names/display names, counts).
  config jsonb not null default '{}'::jsonb,
  -- Admin fulfillment data (real created domains + mailbox SMTP/IMAP creds). Filled in later.
  fulfillment jsonb not null default '{}'::jsonb,
  domain_count integer not null default 0,
  mailbox_count integer not null default 0,
  -- Snapshot of pricing at purchase time (cents).
  domain_cents integer not null default 0,
  mailbox_monthly_cents integer not null default 0,
  setup_cents integer not null default 0,
  one_time_cents integer not null default 0,
  monthly_cents integer not null default 0,
  currency text not null default 'usd',
  terms_accepted boolean not null default false,
  terms_accepted_at timestamptz,
  -- Stripe references.
  environment text,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_orders enable row level security;

-- Customers see + create only their own orders. Admin reads/updates and the
-- Stripe webhook go through the service-role client (bypasses RLS), matching how
-- this project's admin functions and webhooks already work.
create policy "Users view own email orders"
  on public.email_orders for select
  using (auth.uid() = user_id);

create policy "Users create own email orders"
  on public.email_orders for insert
  with check (auth.uid() = user_id);

create index if not exists email_orders_user_idx on public.email_orders(user_id);
create index if not exists email_orders_status_idx on public.email_orders(status);
create index if not exists email_orders_session_idx on public.email_orders(stripe_checkout_session_id);

create trigger email_orders_touch
  before update on public.email_orders
  for each row execute function public.set_updated_at_timestamp();
