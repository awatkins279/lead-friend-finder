
CREATE OR REPLACE FUNCTION public.backfill_leads_step(p_limit int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE n int;
BEGIN
  WITH cte AS (
    SELECT id FROM public.leads WHERE location_tokens IS NULL LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l SET
    employee_min = public.parse_employee_min(l.org_employee_count),
    employee_max = public.parse_employee_max(l.org_employee_count),
    location_tokens = public.build_location_tokens(l.city, l.state, l.country)
  FROM cte WHERE l.id = cte.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
