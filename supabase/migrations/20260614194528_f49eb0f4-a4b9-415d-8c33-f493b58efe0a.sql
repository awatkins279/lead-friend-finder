ALTER TABLE public.sdr_reply_jobs
  ADD COLUMN IF NOT EXISTS positive_alert_sent_at timestamptz;