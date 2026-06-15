import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processOneBatch } from "@/lib/scoring-jobs.functions";

// Background worker invoked by pg_cron every ~10s. Picks up to a small batch
// of running scoring jobs and processes a handful of batches per tick using
// the *_admin RPC variants (no end-user auth context).
//
// Auth: requires `apikey` header == Supabase anon key (matches other
// /api/public/* endpoints in this project). Endpoint must remain idempotent
// because pg_cron may overlap ticks under load.

const MAX_JOBS_PER_TICK = 5;
const BATCHES_PER_JOB_PER_TICK = 6;
const HARD_DEADLINE_MS = 25_000;

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
        const stats = {
          jobs: 0,
          batchesProcessed: 0,
          batchesIdle: 0,
          errors: [] as string[],
        };

        try {
          // Pick the oldest running jobs (across all users — admin context).
          const { data: jobs, error } = await supabaseAdmin
            .from("scoring_jobs")
            .select("id,total_batches,completed_batches,failed_batches")
            .eq("status", "running")
            .order("created_at", { ascending: true })
            .limit(MAX_JOBS_PER_TICK);

          if (error) throw new Error(error.message);
          if (!jobs || jobs.length === 0) {
            return Response.json({ ok: true, ...stats, message: "no running jobs" });
          }

          stats.jobs = jobs.length;

          // Process jobs in parallel; for each job, run BATCHES_PER_JOB_PER_TICK
          // claim+score cycles serially to respect AI gateway rate limits.
          await Promise.all(
            jobs.map(async (job: { id: string }) => {
              for (let i = 0; i < BATCHES_PER_JOB_PER_TICK; i++) {
                if (Date.now() - startedAt > HARD_DEADLINE_MS) return;
                try {
                  const r = await processOneBatch(supabaseAdmin, job.id, true);
                  if (r.claimed) {
                    stats.batchesProcessed += 1;
                  } else {
                    stats.batchesIdle += 1;
                    break; // nothing left to claim for this job
                  }
                } catch (err: any) {
                  const msg = String(err?.message ?? err).slice(0, 200);
                  stats.errors.push(`job ${job.id}: ${msg}`);
                  // Don't break — try next batch (could be a transient AI error)
                }
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

          const { processOperatorPipelines } = await import("@/lib/operator-execution.server");
          await processOperatorPipelines(supabaseAdmin);

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
