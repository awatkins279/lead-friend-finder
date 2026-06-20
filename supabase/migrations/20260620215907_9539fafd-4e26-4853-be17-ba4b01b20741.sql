CREATE OR REPLACE FUNCTION public.leads_total_estimate()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(reltuples, 0)::bigint
  FROM pg_class
  WHERE relname = 'leads' AND relnamespace = 'public'::regnamespace;
$$;

GRANT EXECUTE ON FUNCTION public.leads_total_estimate() TO authenticated, anon;