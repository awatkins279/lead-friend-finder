
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
  v_dead_count int;
begin
  select user_id into v_owner from public.scoring_jobs where scoring_jobs.id = p_job_id;
  if v_owner is null then raise exception 'job not found'; end if;
  if v_owner <> v_user then raise exception 'not authorized'; end if;

  -- Reaper 1: orphaned batches (worker crashed mid-run) under retry budget → requeue
  update public.scoring_job_batches
  set status = 'retry', updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and updated_at < now() - interval '60 seconds'
    and attempts < 3;

  -- Reaper 2: batches stuck in processing that exhausted retries → fail cleanly
  with dead as (
    update public.scoring_job_batches
    set status = 'failed',
        error = coalesce(error, 'orphaned: exceeded retry budget'),
        updated_at = now()
    where job_id = p_job_id
      and status = 'processing'
      and updated_at < now() - interval '120 seconds'
      and attempts >= 3
    returning 1
  )
  select count(*) into v_dead_count from dead;

  if v_dead_count > 0 then
    update public.scoring_jobs
    set failed_batches = failed_batches + v_dead_count,
        updated_at = now()
    where scoring_jobs.id = p_job_id;
  end if;

  with next_batch as (
    select b.id from public.scoring_job_batches b
    where b.job_id = p_job_id
      and b.status in ('pending', 'retry')
      and b.attempts < 3
    order by b.created_at
    for update skip locked
    limit 1
  )
  update public.scoring_job_batches b
  set status = 'processing', attempts = b.attempts + 1, updated_at = now()
  from next_batch
  where b.id = next_batch.id
  returning b.id, b.lead_ids into v_batch_id, v_lead_ids;

  if v_batch_id is null then return; end if;
  id := v_batch_id;
  lead_ids := v_lead_ids;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_scoring_job(p_job_id uuid)
RETURNS TABLE(status text, completed_batches int, failed_batches int, total_batches int, scored_leads int, total_leads int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_dead int;
begin
  select user_id into v_owner from public.scoring_jobs where scoring_jobs.id = p_job_id;
  if v_owner is null then raise exception 'job not found'; end if;
  if v_owner <> v_user then raise exception 'not authorized'; end if;

  -- Mark any leftover non-terminal batches as failed
  with dead as (
    update public.scoring_job_batches
    set status = 'failed',
        error = coalesce(error, 'finalized: stuck batch'),
        updated_at = now()
    where job_id = p_job_id
      and status in ('processing', 'pending', 'retry')
    returning 1
  )
  select count(*) into v_dead from dead;

  if v_dead > 0 then
    update public.scoring_jobs
    set failed_batches = failed_batches + v_dead, updated_at = now()
    where scoring_jobs.id = p_job_id;
  end if;

  -- Set terminal status based on counters
  update public.scoring_jobs j
  set status = case
        when j.failed_batches > 0 and j.completed_batches > 0 then 'completed_with_errors'
        when j.failed_batches > 0 and j.completed_batches = 0 then 'failed'
        else 'completed'
      end,
      updated_at = now()
  where j.id = p_job_id
    and j.status = 'running'
    and j.completed_batches + j.failed_batches >= j.total_batches;

  return query
  select j.status, j.completed_batches, j.failed_batches, j.total_batches, j.scored_leads, j.total_leads
  from public.scoring_jobs j where j.id = p_job_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_scoring_job(uuid) TO authenticated;
