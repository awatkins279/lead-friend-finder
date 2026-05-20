ALTER TABLE public.user_phone_accounts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS credentials jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_phone_accounts
  ALTER COLUMN twilio_account_sid DROP NOT NULL,
  ALTER COLUMN twilio_api_key_sid DROP NOT NULL,
  ALTER COLUMN twilio_api_key_secret DROP NOT NULL,
  ALTER COLUMN twilio_auth_token DROP DEFAULT,
  ALTER COLUMN twilio_auth_token DROP NOT NULL,
  ALTER COLUMN from_number DROP NOT NULL;