import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Signal = {
  label: string;
  verdict: "strong" | "partial" | "weak" | "unknown";
  note: string;
};

export type ScoreRow = {
  leadId: string;
  score: number;
  reasoning: string;
  signals: Signal[];
  strengths: string[];
  gaps: string[];
};

const BATCH_SIZE = 12;
const MAX_LEADS_PER_JOB = 20000;

// ---------- createScoringJob ----------

const createInput = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(MAX_LEADS_PER_JOB),
  context: z.string().min(10).max(4000),
});

export const createScoringJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Dedupe + split into batches of BATCH_SIZE
    const unique = Array.from(new Set(data.leadIds));
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      batches.push(unique.slice(i, i + BATCH_SIZE));
    }

    const { data: job, error: jobErr } = await supabase
      .from("scoring_jobs")
      .insert({
        user_id: userId,
        context: data.context,
        total_batches: batches.length,
        total_leads: unique.length,
        status: "running",
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "Failed to create job");

    const rows = batches.map((leadIds) => ({
      job_id: job.id,
      lead_ids: leadIds,
      status: "pending" as const,
    }));

    // Insert batch rows in chunks of 500 to stay under request size limits
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error } = await supabase.from("scoring_job_batches").insert(slice);
      if (error) {
        await supabase
          .from("scoring_jobs")
          .update({ status: "failed", error: error.message })
          .eq("id", job.id);
        throw new Error(error.message);
      }
    }

    return {
      jobId: job.id as string,
      totalBatches: batches.length,
      totalLeads: unique.length,
    };
  });

// ---------- processNextBatch ----------

const processInput = z.object({ jobId: z.string().uuid() });

export const processNextBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => processInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Atomic claim — uses RPC with SECURITY DEFINER + FOR UPDATE SKIP LOCKED
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_scoring_batch",
      { p_job_id: data.jobId },
    );
    if (claimErr) throw new Error(claimErr.message);

    const batch = Array.isArray(claimed) && claimed.length > 0 ? claimed[0] : null;
    if (!batch) {
      // Nothing to claim — check if job is complete
      const { data: job } = await supabase
        .from("scoring_jobs")
        .select("status,total_batches,completed_batches,failed_batches,scored_leads,total_leads")
        .eq("id", data.jobId)
        .single();

      if (
        job &&
        job.status === "running" &&
        job.completed_batches + job.failed_batches >= job.total_batches
      ) {
        await supabase
          .from("scoring_jobs")
          .update({ status: job.failed_batches > 0 ? "completed_with_errors" : "completed" })
          .eq("id", data.jobId);
      }

      return { claimed: false as const, job: job ?? null };
    }

    const batchId = batch.id as string;
    const leadIds = batch.lead_ids as string[];

    // Load job context
    const { data: job, error: jobErr } = await supabase
      .from("scoring_jobs")
      .select("context")
      .eq("id", data.jobId)
      .single();
    if (jobErr || !job) {
      await markBatchFailed(supabase, data.jobId, batchId, "Job not found");
      throw new Error("Job not found");
    }

    try {
      const results = await scoreBatch(supabase, leadIds, job.context);

      await supabase
        .from("scoring_job_batches")
        .update({ status: "done", results, error: null })
        .eq("id", batchId);

      await bumpJobCounters(supabase, data.jobId, {
        completed: 1,
        scored: results.length,
      });

      // Skip the extra SELECT + maybe-mark-completed round-trip here. The
      // worker loop calls finalize_scoring_job once all workers idle out,
      // which closes the job atomically. Returning a lightweight progress
      // hint keeps the UI updating without an extra query per batch.
      return { claimed: true as const, results, job: null };
    } catch (err: any) {
      const message = String(err?.message ?? "Unknown error").slice(0, 500);

      // Re-queue for retry if under attempt limit, else mark failed
      const { data: batchRow } = await supabase
        .from("scoring_job_batches")
        .select("attempts")
        .eq("id", batchId)
        .single();

      if (batchRow && batchRow.attempts < 3) {
        await supabase
          .from("scoring_job_batches")
          .update({ status: "retry", error: message })
          .eq("id", batchId);
        return { claimed: true as const, results: [], retried: true, error: message };
      }

      await markBatchFailed(supabase, data.jobId, batchId, message);
      return { claimed: true as const, results: [], failed: true, error: message };
    }
  });

// ---------- getJobSnapshot ----------

const snapshotInput = z.object({ jobId: z.string().uuid() });

export const getJobSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => snapshotInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: job, error: jobErr } = await supabase
      .from("scoring_jobs")
      .select(
        "id,context,total_batches,total_leads,completed_batches,failed_batches,scored_leads,status,created_at",
      )
      .eq("id", data.jobId)
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "Job not found");

    const { data: doneBatches, error: batchErr } = await supabase
      .from("scoring_job_batches")
      .select("results")
      .eq("job_id", data.jobId)
      .eq("status", "done");
    if (batchErr) throw new Error(batchErr.message);

    const results: ScoreRow[] = [];
    for (const b of doneBatches ?? []) {
      if (Array.isArray(b.results)) results.push(...(b.results as ScoreRow[]));
    }
    return { job, results };
  });

// ---------- finalizeScoringJob ----------

const finalizeInput = z.object({ jobId: z.string().uuid() });

export const finalizeScoringJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => finalizeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("finalize_scoring_job", {
      p_job_id: data.jobId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    return { job: row };
  });

// ---------- listActiveJobs ----------

export const listActiveJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("scoring_jobs")
      .select(
        "id,context,total_batches,total_leads,completed_batches,failed_batches,scored_leads,status,created_at",
      )
      .eq("user_id", userId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

// ---------- cancelJob ----------

const cancelInput = z.object({ jobId: z.string().uuid() });

export const cancelScoringJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => cancelInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("scoring_jobs")
      .update({ status: "cancelled" })
      .eq("id", data.jobId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- helpers ----------

async function bumpJobCounters(
  supabase: any,
  jobId: string,
  delta: { completed?: number; failed?: number; scored?: number },
) {
  // Atomic SQL-side increment via SECURITY DEFINER RPC. Avoids the
  // read-modify-write race that caused workers to lose progress updates
  // near the end of a run (and made the UI hang on the final ~10% of leads).
  await supabase.rpc("bump_scoring_job_counters", {
    p_job_id: jobId,
    p_completed: delta.completed ?? 0,
    p_failed: delta.failed ?? 0,
    p_scored: delta.scored ?? 0,
  });
}

async function markBatchFailed(supabase: any, jobId: string, batchId: string, message: string) {
  await supabase
    .from("scoring_job_batches")
    .update({ status: "failed", error: message })
    .eq("id", batchId);
  await bumpJobCounters(supabase, jobId, { failed: 1 });
}

// Core scoring logic — same prompt as score.functions.ts
async function scoreBatch(
  supabase: any,
  leadIds: string[],
  sellerContext: string,
): Promise<ScoreRow[]> {
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id,first_name,last_name,title,city,state,country,org_name,org_description,org_industry,org_employee_count,org_technologies_used",
    )
    .in("id", leadIds);
  if (error) throw new Error(error.message);
  if (!leads || leads.length === 0) return [];

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

  const compact = leads.map((l: any) => ({
    id: l.id,
    name: [l.first_name, l.last_name].filter(Boolean).join(" ") || "—",
    title: l.title ?? "",
    location: [l.city, l.state, l.country].filter(Boolean).join(", "),
    company: l.org_name ?? "",
    industry: l.org_industry ?? "",
    headcount: l.org_employee_count ?? "",
    tech: l.org_technologies_used ?? "",
    description: (l.org_description ?? "").slice(0, 400),
  }));

  const system = `You are an elite B2B sales qualification analyst. You score prospects 0-100 on how likely they are to be in-market for the seller's offer right now. Be ruthless and honest: 90+ means "obvious ICP, clear pain, buy now"; 70-89 "strong fit"; 40-69 "plausible but weak signal"; <40 "wrong profile". Use the prospect's title, company industry, size, tech stack, and description as evidence. Do not inflate scores.`;

  const userPrompt = `SELLER CONTEXT (what we're selling / who we want):
${sellerContext}

For every prospect, return a detailed IPP qualification. Return JSON exactly:
{
  "scores": [
    {
      "leadId": "...",
      "score": 0-100,
      "reasoning": "1-2 sentence overall verdict",
      "signals": [
        { "label": "Industry fit", "verdict": "strong|partial|weak|unknown", "note": "1 short sentence with evidence" },
        { "label": "Company size fit", "verdict": "...", "note": "..." },
        { "label": "Role relevance", "verdict": "...", "note": "..." },
        { "label": "Pain point alignment", "verdict": "...", "note": "..." },
        { "label": "Tech / buying signal", "verdict": "...", "note": "..." },
        { "label": "Geography / timing", "verdict": "...", "note": "..." }
      ],
      "strengths": ["2-3 concrete reasons this prospect IS a fit"],
      "gaps": ["1-3 concrete reasons they may NOT be a fit, or 'none' if perfect"]
    }
  ]
}
Use only "strong" / "partial" / "weak" / "unknown" for verdicts. Cite evidence. Do not inflate.

PROSPECTS:
${JSON.stringify(compact)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 16000,
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit");
  if (res.status === 402) throw new Error("AI credits exhausted");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = await res.json();
  const content: string = payload.choices?.[0]?.message?.content ?? "{}";
  let parsed: { scores?: any[] };
  try {
    parsed = extractJson(content) as { scores?: any[] };
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const allowed: Signal["verdict"][] = ["strong", "partial", "weak", "unknown"];
  const scores: ScoreRow[] = (parsed.scores ?? [])
    .map((s: any) => ({
      leadId: String(s.leadId),
      score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 0))),
      reasoning: String(s.reasoning ?? "").slice(0, 400),
      signals: Array.isArray(s.signals)
        ? s.signals
            .filter((x: any) => x && typeof x === "object")
            .map((x: any) => ({
              label: String(x.label ?? "").slice(0, 60),
              verdict: (allowed.includes(x.verdict) ? x.verdict : "unknown") as Signal["verdict"],
              note: String(x.note ?? "").slice(0, 240),
            }))
            .slice(0, 8)
        : [],
      strengths: Array.isArray(s.strengths)
        ? s.strengths.map((v: any) => String(v).slice(0, 200)).slice(0, 5)
        : [],
      gaps: Array.isArray(s.gaps)
        ? s.gaps.map((v: any) => String(v).slice(0, 200)).slice(0, 5)
        : [],
    }))
    .filter((s) => leadIds.includes(s.leadId));

  return scores;
}

function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  s = s.slice(start);
  try { return JSON.parse(s); } catch {}
  let cleaned = s
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  try { return JSON.parse(cleaned); } catch {}
  const arrStart = cleaned.indexOf('"scores"');
  if (arrStart !== -1) {
    const bracketStart = cleaned.indexOf("[", arrStart);
    if (bracketStart !== -1) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let lastGoodEnd = -1;
      for (let i = bracketStart; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) lastGoodEnd = i;
        }
      }
      if (lastGoodEnd !== -1) {
        const repaired = cleaned.slice(0, lastGoodEnd + 1) + "]}";
        return JSON.parse(repaired);
      }
    }
  }
  throw new Error("Unrecoverable JSON");
}
