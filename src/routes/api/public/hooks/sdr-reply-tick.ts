import { createFileRoute } from "@tanstack/react-router";

const MAX_JOBS_PER_TICK = 10;

export const Route = createFileRoute("/api/public/hooks/sdr-reply-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!provided || !expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processSdrReplyJob } = await import("@/lib/sdr-auto-reply.server");
        const { data: jobs, error } = await (supabaseAdmin as any).rpc(
          "claim_sdr_reply_jobs_admin",
          { p_limit: MAX_JOBS_PER_TICK },
        );
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const results = { completed: 0, needs_approval: 0, cancelled: 0, retried: 0, failed: 0 };
        for (const job of jobs ?? []) {
          try {
            const result = await processSdrReplyJob(supabaseAdmin, job);
            results[result.status] += 1;
          } catch (error) {
            const message = String((error as Error).message ?? error).slice(0, 500);
            const finalAttempt = Number(job.attempts) >= Number(job.max_attempts);
            await (supabaseAdmin as any)
              .from("sdr_reply_jobs")
              .update({
                status: finalAttempt ? "failed" : "retry",
                error: message,
                locked_at: null,
                scheduled_for: new Date(
                  Date.now() + 60_000 * Math.max(1, Number(job.attempts)),
                ).toISOString(),
                ...(finalAttempt ? { completed_at: new Date().toISOString() } : {}),
              })
              .eq("id", job.id);
            results[finalAttempt ? "failed" : "retried"] += 1;
          }
        }

        return Response.json({ ok: true, claimed: jobs?.length ?? 0, ...results });
      },
    },
  },
});
