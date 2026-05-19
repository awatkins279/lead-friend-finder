
create table public.scoring_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  context text not null,
  total_batches integer not null default 0,
  total_leads integer not null default 0,
  completed_batches integer not null default 0,
  failed_batches integer not null default 0,
  scored_leads integer not null default 0,
  status text not null default 'running',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scoring_jobs enable row level security;

create policy "Users manage own scoring jobs"
on public.scoring_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create trigger scoring_jobs_touch
before update on public.scoring_jobs
for each row execute function public.touch_updated_at();

create table public.scoring_job_batches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.scoring_jobs(id) on delete cascade,
  lead_ids text[] not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  results jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scoring_job_batches_job_status_idx
  on public.scoring_job_batches (job_id, status);

create index scoring_job_batches_claim_idx
  on public.scoring_job_batches (status, attempts)
  where status in ('pending', 'retry');

alter table public.scoring_job_batches enable row level security;

create policy "Users manage own scoring job batches"
on public.scoring_job_batches
for all
using (
  exists (
    select 1 from public.scoring_jobs j
    where j.id = scoring_job_batches.job_id
      and j.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.scoring_jobs j
    where j.id = scoring_job_batches.job_id
      and j.user_id = auth.uid()
  )
);

create trigger scoring_job_batches_touch
before update on public.scoring_job_batches
for each row execute function public.touch_updated_at();

-- Atomically claim the next pending/retry batch for a given job.
-- Returns the batch id and lead_ids, or no rows if nothing to claim.
create or replace function public.claim_scoring_batch(p_job_id uuid)
returns table (id uuid, lead_ids text[])
language plpgsql
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.claim_scoring_batch(uuid) to authenticated;
