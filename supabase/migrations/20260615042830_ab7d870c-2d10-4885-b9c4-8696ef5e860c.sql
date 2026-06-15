ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS operator_autonomy_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS operator_notification_email TEXT,
  ADD COLUMN IF NOT EXISTS operator_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

UPDATE public.profiles
SET operator_autonomy_enabled = true,
    operator_notification_email = 'acw0916@ttmusa.net',
    operator_notifications_enabled = true
WHERE lower(email) = 'acw0916@ttmusa.net';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_operator_notification_email_length
  CHECK (operator_notification_email IS NULL OR char_length(operator_notification_email) <= 320);