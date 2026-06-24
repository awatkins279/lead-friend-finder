
CREATE OR REPLACE FUNCTION public.backfill_leads_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $$
DECLARE n int;
BEGIN
  WITH cte AS (
    SELECT id FROM public.leads WHERE location_tokens IS NULL LIMIT 10000 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l SET
    employee_min = public.parse_employee_min(l.org_employee_count),
    employee_max = public.parse_employee_max(l.org_employee_count),
    location_tokens = public.build_location_tokens(l.city, l.state, l.country)
  FROM cte WHERE l.id = cte.id;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Stop the cron job once nothing remains
  IF n = 0 THEN
    PERFORM cron.unschedule('backfill_leads');
  END IF;
END $$;

SELECT cron.schedule('backfill_leads', '30 seconds', 'SELECT public.backfill_leads_tick();');
