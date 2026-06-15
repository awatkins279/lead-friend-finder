CREATE OR REPLACE FUNCTION public.create_operator_scoring_job_admin(
  p_user_id uuid,
  p_context text,
  p_max_leads integer,
  p_rubric jsonb,
  p_titles text[] DEFAULT '{}'::text[],
  p_industries text[] DEFAULT '{}'::text[],
  p_locations text[] DEFAULT '{}'::text[]
)
RETURNS TABLE(job_id uuid, total_leads integer, total_batches integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_total integer;
  v_batches integer;
BEGIN
  INSERT INTO public.scoring_jobs(user_id, context, total_batches, total_leads, status, scoring_mode, rubric)
  VALUES (p_user_id, left(p_context, 4000), 0, 0, 'running', 'hybrid_fast', coalesce(p_rubric, '{}'::jsonb))
  RETURNING id INTO v_job_id;

  WITH matched AS MATERIALIZED (
    SELECT l.id, row_number() OVER (ORDER BY l.id) AS row_num
    FROM public.leads l
    WHERE l.email IS NOT NULL
      AND (cardinality(p_titles) = 0 OR l.title ILIKE ANY (SELECT '%' || value || '%' FROM unnest(p_titles) AS value))
      AND (cardinality(p_industries) = 0 OR l.org_industry ILIKE ANY (SELECT '%' || value || '%' FROM unnest(p_industries) AS value))
      AND (cardinality(p_locations) = 0 OR l.country ILIKE ANY (SELECT '%' || value || '%' FROM unnest(p_locations) AS value))
    ORDER BY l.id
    LIMIT least(greatest(p_max_leads, 1), 100000)
  ), inserted AS (
    INSERT INTO public.scoring_job_batches(job_id, lead_ids, status)
    SELECT v_job_id, array_agg(id ORDER BY row_num), 'pending'
    FROM matched
    GROUP BY ((row_num - 1) / 250)::integer
    RETURNING cardinality(lead_ids) AS batch_size
  )
  SELECT coalesce(sum(batch_size), 0)::integer, count(*)::integer
  INTO v_total, v_batches
  FROM inserted;

  UPDATE public.scoring_jobs
  SET total_leads = v_total,
      total_batches = v_batches,
      status = CASE WHEN v_total = 0 THEN 'failed' ELSE 'running' END,
      error = CASE WHEN v_total = 0 THEN 'No matching contacts with email addresses' ELSE NULL END,
      updated_at = now()
  WHERE id = v_job_id;

  RETURN QUERY SELECT v_job_id, v_total, v_batches;
END;
$$;

REVOKE ALL ON FUNCTION public.create_operator_scoring_job_admin(uuid, text, integer, jsonb, text[], text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_operator_scoring_job_admin(uuid, text, integer, jsonb, text[], text[], text[]) TO service_role;