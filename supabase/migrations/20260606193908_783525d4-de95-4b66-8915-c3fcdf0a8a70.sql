REVOKE EXECUTE ON FUNCTION public.claim_scoring_batch_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_scoring_job_counters_admin(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_scoring_job_admin(uuid) FROM PUBLIC, anon, authenticated;