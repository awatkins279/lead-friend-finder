REVOKE ALL ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_lead_ids_for_people_search(uuid, jsonb, integer) TO service_role;