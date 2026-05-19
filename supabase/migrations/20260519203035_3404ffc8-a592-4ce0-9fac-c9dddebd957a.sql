alter table public.user_phone_accounts
  add column if not exists twilio_auth_token text not null default '';
