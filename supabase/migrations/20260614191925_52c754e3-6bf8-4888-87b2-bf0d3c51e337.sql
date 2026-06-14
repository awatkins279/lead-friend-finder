CREATE TABLE public.sdr_reply_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.sdr_conversations(id) ON DELETE CASCADE,
  inbound_message_id uuid NOT NULL REFERENCES public.sdr_messages(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.sdr_agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'needs_approval', 'retry', 'failed', 'cancelled')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  draft_message_id uuid REFERENCES public.sdr_messages(id) ON DELETE SET NULL,
  error text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inbound_message_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sdr_reply_jobs TO authenticated;
GRANT ALL ON public.sdr_reply_jobs TO service_role;

ALTER TABLE public.sdr_reply_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own SDR reply jobs"
ON public.sdr_reply_jobs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sdr_reply_jobs_due
ON public.sdr_reply_jobs (scheduled_for, created_at)
WHERE status IN ('pending', 'retry');

CREATE INDEX idx_sdr_reply_jobs_user
ON public.sdr_reply_jobs (user_id, created_at DESC);

CREATE TRIGGER trg_sdr_reply_jobs_updated
BEFORE UPDATE ON public.sdr_reply_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.claim_sdr_reply_jobs_admin(p_limit integer DEFAULT 10)
RETURNS SETOF public.sdr_reply_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.sdr_reply_jobs
  SET status = 'retry', locked_at = NULL, updated_at = now()
  WHERE status = 'processing'
    AND locked_at < now() - interval '5 minutes'
    AND attempts < max_attempts;

  UPDATE public.sdr_reply_jobs
  SET status = 'failed',
      error = coalesce(error, 'Automatic reply exceeded retry limit'),
      completed_at = now(),
      updated_at = now()
  WHERE status IN ('processing', 'retry')
    AND attempts >= max_attempts;

  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.sdr_reply_jobs
    WHERE status IN ('pending', 'retry')
      AND scheduled_for <= now()
      AND attempts < max_attempts
    ORDER BY scheduled_for, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
  )
  UPDATE public.sdr_reply_jobs j
  SET status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      updated_at = now()
  FROM due
  WHERE j.id = due.id
  RETURNING j.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_sdr_reply_jobs_admin(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_sdr_reply_jobs_admin(integer) TO service_role;