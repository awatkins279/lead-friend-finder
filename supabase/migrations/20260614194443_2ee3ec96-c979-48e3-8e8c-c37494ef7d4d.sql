ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS sending_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  ADD COLUMN IF NOT EXISTS sending_start_time time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS sending_end_time time NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS sending_timezone text NOT NULL DEFAULT 'America/Detroit',
  ADD COLUMN IF NOT EXISTS follow_up_delay_days integer NOT NULL DEFAULT 3 CHECK (follow_up_delay_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS email_gap_minutes integer NOT NULL DEFAULT 10 CHECK (email_gap_minutes BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS positive_reply_alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS positive_reply_alert_email text;