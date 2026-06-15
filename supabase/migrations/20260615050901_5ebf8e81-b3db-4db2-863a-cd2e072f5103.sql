ALTER TABLE public.scoring_jobs
  ADD COLUMN IF NOT EXISTS scoring_mode text NOT NULL DEFAULT 'hybrid_fast',
  ADD COLUMN IF NOT EXISTS rubric jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.scoring_results (
  job_id uuid NOT NULL REFERENCES public.scoring_jobs(id) ON DELETE CASCADE,
  lead_id text NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  reasoning text NOT NULL DEFAULT '',
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  deep_status text NOT NULL DEFAULT 'not_requested' CHECK (deep_status IN ('not_requested','pending','processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, lead_id)
);
GRANT SELECT ON public.scoring_results TO authenticated;
GRANT ALL ON public.scoring_results TO service_role;
ALTER TABLE public.scoring_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own scoring results"
  ON public.scoring_results FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX scoring_results_user_job_idx ON public.scoring_results(user_id, job_id);
CREATE INDEX scoring_results_job_score_idx ON public.scoring_results(job_id, score DESC);
CREATE INDEX scoring_jobs_running_created_idx ON public.scoring_jobs(status, created_at) WHERE status = 'running';

CREATE TRIGGER scoring_results_touch_updated_at
  BEFORE UPDATE ON public.scoring_results
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.process_fast_scoring_batch_admin(p_job_id uuid, p_limit integer DEFAULT 1000)
RETURNS TABLE(processed integer, completed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_rubric jsonb;
  v_context text;
  v_processed integer := 0;
BEGIN
  SELECT user_id, rubric, context INTO v_user_id, v_rubric, v_context
  FROM public.scoring_jobs WHERE id = p_job_id AND status = 'running';
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT 0, true;
    RETURN;
  END IF;

  WITH claimed AS (
    SELECT b.id, b.lead_ids
    FROM public.scoring_job_batches b
    WHERE b.job_id = p_job_id AND b.status IN ('pending','retry') AND b.attempts < 3
    ORDER BY b.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(CEIL(GREATEST(p_limit, 1) / 250.0)::integer, 40))
  ), marked AS (
    UPDATE public.scoring_job_batches b
    SET status = 'processing', attempts = attempts + 1, updated_at = now()
    FROM claimed c WHERE b.id = c.id
    RETURNING b.id, b.lead_ids
  ), candidates AS (
    SELECT m.id AS batch_id, unnest(m.lead_ids) AS lead_id FROM marked m
  ), scored AS (
    SELECT c.batch_id, l.id AS lead_id,
      LEAST(100, GREATEST(0,
        25
        + CASE WHEN l.email IS NOT NULL AND l.email <> '' THEN 8 ELSE -8 END
        + CASE WHEN l.phone IS NOT NULL AND l.phone <> '' THEN 5 ELSE 0 END
        + CASE WHEN COALESCE(l.title,'') <> '' THEN 5 ELSE -5 END
        + CASE WHEN COALESCE(l.org_industry,'') <> '' THEN 5 ELSE 0 END
        + CASE WHEN COALESCE(l.org_description,'') <> '' THEN 4 ELSE 0 END
        + CASE WHEN COALESCE(l.title,'') ILIKE ANY (SELECT '%' || value || '%' FROM jsonb_array_elements_text(COALESCE(v_rubric->'titles','[]'::jsonb))) THEN 24 ELSE 0 END
        + CASE WHEN COALESCE(l.org_industry,'') ILIKE ANY (SELECT '%' || value || '%' FROM jsonb_array_elements_text(COALESCE(v_rubric->'industries','[]'::jsonb))) THEN 18 ELSE 0 END
        + CASE WHEN (COALESCE(l.title,'') || ' ' || COALESCE(l.org_description,'') || ' ' || COALESCE(l.org_technologies_used,'')) ILIKE ANY (SELECT '%' || value || '%' FROM jsonb_array_elements_text(COALESCE(v_rubric->'keywords','[]'::jsonb))) THEN 11 ELSE 0 END
        + CASE WHEN COALESCE(l.title,'') ILIKE ANY (SELECT '%' || value || '%' FROM jsonb_array_elements_text(COALESCE(v_rubric->'exclusions','[]'::jsonb))) THEN -35 ELSE 0 END
      ))::integer AS score
    FROM candidates c JOIN public.leads l ON l.id = c.lead_id
  ), inserted AS (
    INSERT INTO public.scoring_results(job_id, lead_id, user_id, score, reasoning, signals, strengths, gaps, deep_status)
    SELECT p_job_id, s.lead_id, v_user_id, s.score,
      CASE WHEN s.score >= 70 THEN 'Strong match against the campaign targeting rubric.' WHEN s.score >= 45 THEN 'Partial match; review campaign fit before outreach.' ELSE 'Weak match against the campaign targeting rubric.' END,
      jsonb_build_array(jsonb_build_object('label','Hybrid ICP match','verdict',CASE WHEN s.score >= 70 THEN 'strong' WHEN s.score >= 45 THEN 'partial' ELSE 'weak' END,'note','Fast score based on role, company, contactability, and campaign keywords.')),
      CASE WHEN s.score >= 70 THEN jsonb_build_array('Matches high-value campaign signals') ELSE '[]'::jsonb END,
      CASE WHEN s.score < 45 THEN jsonb_build_array('Limited evidence of campaign fit') ELSE '[]'::jsonb END,
      CASE WHEN s.score BETWEEN 55 AND 85 THEN 'pending' ELSE 'not_requested' END
    FROM scored s
    ON CONFLICT (job_id, lead_id) DO UPDATE SET score=EXCLUDED.score, reasoning=EXCLUDED.reasoning, signals=EXCLUDED.signals, strengths=EXCLUDED.strengths, gaps=EXCLUDED.gaps, deep_status=EXCLUDED.deep_status, updated_at=now()
    RETURNING lead_id
  ), batch_results AS (
    SELECT s.batch_id, jsonb_agg(jsonb_build_object('leadId',s.lead_id,'score',s.score,'reasoning',CASE WHEN s.score >= 70 THEN 'Strong match against the campaign targeting rubric.' WHEN s.score >= 45 THEN 'Partial match; review campaign fit before outreach.' ELSE 'Weak match against the campaign targeting rubric.' END,'signals',jsonb_build_array(jsonb_build_object('label','Hybrid ICP match','verdict',CASE WHEN s.score >= 70 THEN 'strong' WHEN s.score >= 45 THEN 'partial' ELSE 'weak' END,'note','Fast score based on role, company, contactability, and campaign keywords.')),'strengths',CASE WHEN s.score >= 70 THEN jsonb_build_array('Matches high-value campaign signals') ELSE '[]'::jsonb END,'gaps',CASE WHEN s.score < 45 THEN jsonb_build_array('Limited evidence of campaign fit') ELSE '[]'::jsonb END)) AS results,
      count(*)::integer AS count
    FROM scored s GROUP BY s.batch_id
  ), finished AS (
    UPDATE public.scoring_job_batches b SET status='done', results=br.results, error=NULL, updated_at=now()
    FROM batch_results br WHERE b.id=br.batch_id AND b.status='processing'
    RETURNING br.count
  )
  SELECT COALESCE(sum(count),0)::integer INTO v_processed FROM finished;

  UPDATE public.scoring_jobs j
  SET completed_batches = x.done_count,
      failed_batches = x.failed_count,
      scored_leads = x.scored_count,
      status = CASE WHEN x.open_count = 0 THEN CASE WHEN x.failed_count > 0 THEN 'completed_with_errors' ELSE 'completed' END ELSE j.status END,
      updated_at = now()
  FROM (
    SELECT count(*) FILTER (WHERE status='done')::integer done_count,
           count(*) FILTER (WHERE status='failed')::integer failed_count,
           count(*) FILTER (WHERE status IN ('pending','retry','processing'))::integer open_count,
           COALESCE((SELECT count(*) FROM public.scoring_results r WHERE r.job_id=p_job_id),0)::integer scored_count
    FROM public.scoring_job_batches WHERE job_id=p_job_id
  ) x WHERE j.id=p_job_id;

  RETURN QUERY SELECT v_processed, NOT EXISTS (SELECT 1 FROM public.scoring_job_batches WHERE job_id=p_job_id AND status IN ('pending','retry','processing'));
END;
$$;
REVOKE ALL ON FUNCTION public.process_fast_scoring_batch_admin(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_fast_scoring_batch_admin(uuid, integer) TO service_role;