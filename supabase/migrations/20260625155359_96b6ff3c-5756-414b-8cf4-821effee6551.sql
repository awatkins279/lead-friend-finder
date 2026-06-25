CREATE INDEX IF NOT EXISTS scoring_results_deep_pending_idx
  ON public.scoring_results (job_id, lead_id)
  WHERE deep_status = 'pending';

CREATE OR REPLACE FUNCTION public.claim_deep_scoring_batch_admin(p_limit integer DEFAULT 20)
RETURNS TABLE(
  job_id uuid,
  user_id uuid,
  context text,
  lead_id text,
  first_name text,
  last_name text,
  title text,
  city text,
  state text,
  country text,
  org_name text,
  org_description text,
  org_industry text,
  org_employee_count integer,
  org_technologies_used text,
  prior_score integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT r.job_id, r.lead_id
    FROM public.scoring_results r
    WHERE r.deep_status = 'pending'
    ORDER BY r.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  ), marked AS (
    UPDATE public.scoring_results r
    SET deep_status = 'processing', updated_at = now()
    FROM claimed c
    WHERE r.job_id = c.job_id AND r.lead_id = c.lead_id
    RETURNING r.job_id, r.lead_id, r.score
  )
  SELECT
    m.job_id,
    j.user_id,
    j.context,
    m.lead_id,
    l.first_name, l.last_name, l.title, l.city, l.state, l.country,
    l.org_name, l.org_description, l.org_industry,
    l.org_employee_count, l.org_technologies_used,
    m.score AS prior_score
  FROM marked m
  JOIN public.scoring_jobs j ON j.id = m.job_id
  JOIN public.leads l ON l.id = m.lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_deep_scoring_batch_admin(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deep_scoring_batch_admin(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_deep_scoring_admin(p_job_id uuid, p_lead_ids text[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scoring_results
  SET deep_status = 'failed', updated_at = now()
  WHERE job_id = p_job_id AND lead_id = ANY(p_lead_ids) AND deep_status = 'processing';
$$;
REVOKE ALL ON FUNCTION public.fail_deep_scoring_admin(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_deep_scoring_admin(uuid, text[]) TO service_role;

DO $$
DECLARE
  v_cmd text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'scoring-tick' LIMIT 1;
  IF v_cmd IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deep-scoring-tick') THEN
    PERFORM cron.unschedule('deep-scoring-tick');
  END IF;

  PERFORM cron.schedule(
    'deep-scoring-tick',
    '* * * * *',
    replace(v_cmd, '/api/public/hooks/scoring-tick', '/api/public/hooks/deep-scoring-tick')
  );
END;
$$;