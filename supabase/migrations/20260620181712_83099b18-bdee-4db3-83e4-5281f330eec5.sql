create table if not exists public.email_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'pending',
  config jsonb not null default '{}'::jsonb,
  fulfillment jsonb not null default '{}'::jsonb,
  domain_count int not null default 0,
  mailbox_count int not null default 0,
  domain_cents int not null default 0,
  mailbox_monthly_cents int not null default 0,
  setup_cents int not null default 0,
  one_time_cents int not null default 0,
  monthly_cents int not null default 0,
  currency text not null default 'usd',
  terms_accepted boolean not null default false,
  terms_accepted_at timestamptz,
  environment text,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.email_orders to authenticated;
grant all on public.email_orders to service_role;

alter table public.email_orders enable row level security;

create policy "Users view own email orders" on public.email_orders
  for select using (auth.uid() = user_id);
create policy "Users create own email orders" on public.email_orders
  for insert with check (auth.uid() = user_id);

create index if not exists email_orders_user_idx on public.email_orders(user_id);
create index if not exists email_orders_status_idx on public.email_orders(status);
create index if not exists email_orders_session_idx on public.email_orders(stripe_checkout_session_id);

drop trigger if exists email_orders_touch on public.email_orders;
create trigger email_orders_touch before update on public.email_orders
  for each row execute function public.set_updated_at_timestamp();