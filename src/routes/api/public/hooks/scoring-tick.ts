import { createFileRoute } from "@tanstack/react-router";
import { processOneBatch } from "@/lib/scoring-jobs.functions";

// Background worker invoked by pg_cron. One invocation keeps advancing work
// for most of its runtime so scoring and operator stages do not wait a minute.
//
// Auth: requires `apikey` header == Supabase anon key (matches other
// /api/public/* endpoints in this project). Endpoint must remain idempotent
// because pg_cron may overlap ticks under load.

const MAX_JOBS_PER_TICK = 5;
const BATCHES_PER_JOB_PER_TICK = 6;
const CONCURRENT_BATCHES_PER_JOB = 3;
const HARD_DEADLINE_MS = 45_000;
const LOOP_DELAY_MS = 2_000;

export const Route = createFileRoute("/api/public/hooks/scoring-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apiKey || !expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const startedAt = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const stats = {
          jobs: 0,
          batchesProcessed: 0,
          batchesIdle: 0,
          errors: [] as string[],
        };

        try {
          const { processOperatorPipelines } = await import("@/lib/operator-execution.server");
          do {
            const { data: jobs, error } = await supabaseAdmin
              .from("scoring_jobs")
              .select("id,total_batches,completed_batches,failed_batches")
              .eq("status", "running")
              .order("created_at", { ascending: true })
              .limit(MAX_JOBS_PER_TICK);
            if (error) throw new Error(error.message);
            stats.jobs = Math.max(stats.jobs, jobs?.length ?? 0);

            await Promise.all(
              (jobs ?? []).map(async (job: { id: string }) => {
              const { data: fastRows, error: fastError } = await supabaseAdmin.rpc(
                "process_fast_scoring_batch_admin",
                { p_job_id: job.id, p_limit: 5_000 },
              );
              if (fastError) {
                stats.errors.push(`job ${job.id}: ${fastError.message}`);
                return;
              }
              const fastCount = Number(fastRows?.[0]?.processed ?? 0);
              if (fastCount > 0) {
                stats.batchesProcessed += Math.ceil(fastCount / 250);
                return;
              }
              for (let i = 0; i < BATCHES_PER_JOB_PER_TICK; i += CONCURRENT_BATCHES_PER_JOB) {
                if (Date.now() - startedAt > HARD_DEADLINE_MS) return;
                const settled = await Promise.allSettled(
                  Array.from({ length: CONCURRENT_BATCHES_PER_JOB }, () =>
                    processOneBatch(supabaseAdmin, job.id, true),
                  ),
                );
                let claimedInGroup = 0;
                for (const result of settled) {
                  if (result.status === "fulfilled") {
                    if (result.value.claimed) {
                      claimedInGroup += 1;
                      stats.batchesProcessed += 1;
                    } else {
                      stats.batchesIdle += 1;
                    }
                  } else {
                    const msg = String(result.reason?.message ?? result.reason).slice(0, 200);
                    stats.errors.push(`job ${job.id}: ${msg}`);
                  }
                }
                if (claimedInGroup === 0) break;
              }

              // Finalize only after every batch is terminal. The previous
              // unconditional call marked pending/processing batches as failed
              // while the browser worker was still actively scoring them.
              try {
                const { data: current } = await supabaseAdmin
                  .from("scoring_jobs")
                  .select("total_batches,completed_batches,failed_batches")
                  .eq("id", job.id)
                  .single();
                if (
                  current &&
                  current.completed_batches + current.failed_batches >= current.total_batches
                ) {
                  await supabaseAdmin.rpc("finalize_scoring_job_admin", { p_job_id: job.id });
                }
              } catch {
                // ignore — next tick will retry
              }
              }),
            );
            await processOperatorPipelines(supabaseAdmin, 8);
            if (Date.now() - startedAt + LOOP_DELAY_MS >= HARD_DEADLINE_MS) break;
            await new Promise((resolve) => setTimeout(resolve, LOOP_DELAY_MS));
          } while (Date.now() - startedAt < HARD_DEADLINE_MS);

          return Response.json({
            ok: true,
            elapsed_ms: Date.now() - startedAt,
            ...stats,
          });
        } catch (err: any) {
          console.error("scoring-tick failed", err);
          return Response.json(
            {
              ok: false,
              error: String(err?.message ?? err).slice(0, 500),
              ...stats,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
