ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS campaign_status text NOT NULL DEFAULT 'draft'
    CHECK (campaign_status IN ('draft', 'active', 'paused', 'completed')),
  ADD COLUMN IF NOT EXISTS launched_at timestamptz;

CREATE TABLE public.campaign_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  lead_id text NOT NULL,
  email_account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE RESTRICT,
  sequence_step integer NOT NULL CHECK (sequence_step BETWEEN 1 AND 50),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 500),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id text,
  error text,
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, lead_id, sequence_step)
);

GRANT SELECT ON public.campaign_email_sends TO authenticated;
GRANT ALL ON public.campaign_email_sends TO service_role;

ALTER TABLE public.campaign_email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own campaign email sends"
  ON public.campaign_email_sends
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX campaign_email_sends_due_idx
  ON public.campaign_email_sends(status, scheduled_for)
  WHERE status = 'queued';
CREATE INDEX campaign_email_sends_list_idx
  ON public.campaign_email_sends(list_id, created_at DESC);

CREATE TRIGGER campaign_email_sends_touch
  BEFORE UPDATE ON public.campaign_email_sends
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.claim_campaign_email_sends_admin(p_limit integer DEFAULT 20)
RETURNS SETOF public.campaign_email_sends
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT ces.id
    FROM public.campaign_email_sends ces
    JOIN public.lists l ON l.id = ces.list_id
    WHERE ces.status = 'queued'
      AND ces.scheduled_for <= now()
      AND l.campaign_status = 'active'
    ORDER BY ces.scheduled_for, ces.created_at
    FOR UPDATE OF ces SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.campaign_email_sends ces
  SET status = 'processing', locked_at = now(), attempts = ces.attempts + 1
  FROM claimed
  WHERE ces.id = claimed.id
  RETURNING ces.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_email_sends_admin(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_email_sends_admin(integer) TO service_role;