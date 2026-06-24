
CREATE OR REPLACE FUNCTION public.backfill_leads_step(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '55s'
AS $function$
DECLARE n int;
BEGIN
  WITH cte AS (
    SELECT id FROM public.leads
    WHERE location_tokens IS NULL
    ORDER BY id
    LIMIT LEAST(GREATEST(p_limit, 1), 5000)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.leads l SET
    employee_min    = public.parse_employee_min(l.org_employee_count),
    employee_max    = public.parse_employee_max(l.org_employee_count),
    location_tokens = public.build_location_tokens(l.city, l.state, l.country)
  FROM cte WHERE l.id = cte.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.backfill_leads_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '110s'
AS $function$
DECLARE total int := 0; n int;
BEGIN
  FOR i IN 1..8 LOOP
    SELECT public.backfill_leads_step(5000) INTO n;
    total := total + n;
    EXIT WHEN n = 0;
  END LOOP;
  IF total = 0 THEN
    PERFORM cron.unschedule('backfill_leads');
  END IF;
END $function$;
