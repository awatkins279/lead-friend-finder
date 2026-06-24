REVOKE ALL ON FUNCTION public.count_leads_for_people_search(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_leads_for_people_search(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.count_leads_for_people_search(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_leads_for_people_search(uuid, jsonb) TO service_role;