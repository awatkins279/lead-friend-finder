
revoke execute on function public.claim_scoring_batch(uuid) from public;
revoke execute on function public.claim_scoring_batch(uuid) from anon;
grant execute on function public.claim_scoring_batch(uuid) to authenticated;
