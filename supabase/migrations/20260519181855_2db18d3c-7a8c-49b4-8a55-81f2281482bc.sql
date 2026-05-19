
CREATE OR REPLACE FUNCTION public.claim_scoring_batch(p_job_id uuid)
 RETURNS TABLE(id uuid, lead_ids text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_batch_id uuid;
  v_lead_ids text[];
begin
  select user_id into v_owner from public.scoring_jobs where scoring_jobs.id = p_job_id;
  if v_owner is null then
    raise exception 'job not found';
  end if;
  if v_owner <> v_user then
    raise exception 'not authorized';
  end if;

  -- Reaper: any batch stuck in 'processing' for >90s is treated as orphaned
  -- (worker crashed / function timed out) and re-queued for retry.
  update public.scoring_job_batches
  set status = 'retry', updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and updated_at < now() - interval '90 seconds'
    and attempts < 3;

  with next_batch as (
    select b.id
    from public.scoring_job_batches b
    where b.job_id = p_job_id
      and b.status in ('pending', 'retry')
      and b.attempts < 3
    order by b.created_at
    for update skip locked
    limit 1
  )
  update public.scoring_job_batches b
  set status = 'processing',
      attempts = b.attempts + 1,
      updated_at = now()
  from next_batch
  where b.id = next_batch.id
  returning b.id, b.lead_ids
  into v_batch_id, v_lead_ids;

  if v_batch_id is null then
    return;
  end if;

  id := v_batch_id;
  lead_ids := v_lead_ids;
  return next;
end;
$function$;
