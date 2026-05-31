
CREATE OR REPLACE FUNCTION public.bump_scoring_job_counters(
  p_job_id uuid,
  p_completed int DEFAULT 0,
  p_failed int DEFAULT 0,
  p_scored int DEFAULT 0
)
RETURNS TABLE(
  status text,
  total_batches int,
  completed_batches int,
  failed_batches int,
  scored_leads int,
  total_leads int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.scoring_jobs WHERE id = p_job_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'job not found'; END IF;
  IF v_owner <> v_user THEN RAISE EXCEPTION 'not authorized'; END IF;

  UPDATE public.scoring_jobs j
  SET completed_batches = j.completed_batches + p_completed,
      failed_batches = j.failed_batches + p_failed,
      scored_leads = j.scored_leads + p_scored,
      updated_at = now()
  WHERE j.id = p_job_id;

  -- Auto-terminate if all batches are accounted for
  UPDATE public.scoring_jobs j
  SET status = CASE
        WHEN j.failed_batches > 0 AND j.completed_batches > 0 THEN 'completed_with_errors'
        WHEN j.failed_batches > 0 AND j.completed_batches = 0 THEN 'failed'
        ELSE 'completed'
      END,
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.status = 'running'
    AND j.completed_batches + j.failed_batches >= j.total_batches;

  RETURN QUERY
  SELECT j.status, j.total_batches, j.completed_batches, j.failed_batches, j.scored_leads, j.total_leads
  FROM public.scoring_jobs j WHERE j.id = p_job_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_scoring_job_counters(uuid, int, int, int) TO authenticated;
