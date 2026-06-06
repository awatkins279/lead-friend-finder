-- Admin (no auth.uid() check) variants of scoring job RPCs.
-- Used by the pg_cron tick endpoint that runs server-side via service_role.

CREATE OR REPLACE FUNCTION public.claim_scoring_batch_admin(p_job_id uuid)
RETURNS TABLE(id uuid, lead_ids text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_batch_id uuid;
  v_lead_ids text[];
  v_dead_count int;
begin
  -- Reaper 1: orphaned batches under retry budget → requeue
  update public.scoring_job_batches
  set status = 'retry', updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and updated_at < now() - interval '60 seconds'
    and attempts < 3;

  -- Reaper 2: exhausted retries → fail
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

CREATE OR REPLACE FUNCTION public.bump_scoring_job_counters_admin(
  p_job_id uuid,
  p_completed integer DEFAULT 0,
  p_failed integer DEFAULT 0,
  p_scored integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.scoring_jobs j
  SET completed_batches = j.completed_batches + p_completed,
      failed_batches = j.failed_batches + p_failed,
      scored_leads = j.scored_leads + p_scored,
      updated_at = now()
  WHERE j.id = p_job_id;

  UPDATE public.scoring_jobs j
  SET status = CASE
        WHEN j.failed_batches > 0 AND j.completed_batches > 0 THEN 'completed_with_errors'
        WHEN j.failed_batches > 0 AND j.completed_batches = 0 THEN 'failed'
        ELSE 'completed'
      END,
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.status = 'running'
    AND j.completed_batches + j.failed_batches >= j.total_batches;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_scoring_job_admin(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_dead int;
begin
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
end;
$function$;

-- Grants for service_role (used by the cron tick route)
GRANT EXECUTE ON FUNCTION public.claim_scoring_batch_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_scoring_job_counters_admin(uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_scoring_job_admin(uuid) TO service_role;