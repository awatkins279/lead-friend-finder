import { createFileRoute } from "@tanstack/react-router";

// Deep AI scoring worker.
//
// Pipeline:
//   1. Fast SQL scorer (process_fast_scoring_batch_admin) writes triage scores
//      and flags borderline rows (55-85) as deep_status='pending'.
//   2. This worker claims pending rows in small batches and re-scores them with
//      Lovable AI using the same rubric as the interactive scoreLeads fn.
//   3. Results overwrite the fast triage row and mark deep_status='completed'.
//
// Auth: requires `apikey` header == Supabase publishable key (matches other
// /api/public/* hooks). Safe to invoke repeatedly — claim is SKIP LOCKED.

const HARD_DEADLINE_MS = 45_000;
const BATCH_SIZE = 12; // leads per AI call
const MAX_BATCHES_PER_TICK = 8; // upper bound per invocation
const LOOP_DELAY_MS = 500;

type Verdict = "strong" | "partial" | "weak" | "unknown";
type Signal = { label: string; verdict: Verdict; note: string };
type AiScore = {
  leadId: string;
  score: number;
  reasoning: string;
  signals: Signal[];
  strengths: string[];
  gaps: string[];
};

type ClaimedRow = {
  job_id: string;
  user_id: string;
  context: string;
  lead_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  org_name: string | null;
  org_description: string | null;
  org_industry: string | null;
  org_employee_count: number | null;
  org_technologies_used: string | null;
  prior_score: number | null;
};

export const Route = createFileRoute("/api/public/hooks/deep-scoring-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apiKey || !expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!lovableKey) {
          return Response.json({ ok: false, error: "Missing LOVABLE_API_KEY" }, { status: 500 });
        }

        const startedAt = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const stats = {
          batches: 0,
          rowsScored: 0,
          rowsFailed: 0,
          errors: [] as string[],
        };

        try {
          for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
            if (Date.now() - startedAt + LOOP_DELAY_MS >= HARD_DEADLINE_MS) break;

            const { data: claimed, error: claimErr } = await supabaseAdmin.rpc(
              "claim_deep_scoring_batch_admin",
              { p_limit: BATCH_SIZE },
            );
            if (claimErr) {
              stats.errors.push(`claim: ${claimErr.message}`);
              break;
            }
            const rows = (claimed ?? []) as ClaimedRow[];
            if (rows.length === 0) break;

            // All rows in a single claim share the same job because we order
            // by updated_at — but be defensive and group by job_id anyway.
            const byJob = new Map<string, ClaimedRow[]>();
            for (const r of rows) {
              const arr = byJob.get(r.job_id) ?? [];
              arr.push(r);
              byJob.set(r.job_id, arr);
            }

            for (const [jobId, jobRows] of byJob) {
              try {
                const scored = await scoreBatchWithAi(jobRows, lovableKey);
                if (scored.length === 0) {
                  await supabaseAdmin.rpc("fail_deep_scoring_admin", {
                    p_job_id: jobId,
                    p_lead_ids: jobRows.map((r) => r.lead_id),
                  });
                  stats.rowsFailed += jobRows.length;
                  continue;
                }
                const updates = scored.map((s) => ({
                  job_id: jobId,
                  lead_id: s.leadId,
                  user_id: jobRows.find((r) => r.lead_id === s.leadId)?.user_id ?? jobRows[0]!.user_id,
                  score: s.score,
                  reasoning: s.reasoning,
                  signals: s.signals,
                  strengths: s.strengths,
                  gaps: s.gaps,
                  deep_status: "completed",
                  updated_at: new Date().toISOString(),
                }));
                const { error: upErr } = await supabaseAdmin
                  .from("scoring_results")
                  .upsert(updates, { onConflict: "job_id,lead_id" });
                if (upErr) {
                  stats.errors.push(`upsert: ${upErr.message}`);
                  await supabaseAdmin.rpc("fail_deep_scoring_admin", {
                    p_job_id: jobId,
                    p_lead_ids: jobRows.map((r) => r.lead_id),
                  });
                  stats.rowsFailed += jobRows.length;
                } else {
                  stats.rowsScored += updates.length;

                  // Mark any leads in the batch the AI skipped as failed so
                  // they don't sit in 'processing' forever.
                  const scoredIds = new Set(updates.map((u) => u.lead_id));
                  const missed = jobRows.filter((r) => !scoredIds.has(r.lead_id));
                  if (missed.length > 0) {
                    await supabaseAdmin.rpc("fail_deep_scoring_admin", {
                      p_job_id: jobId,
                      p_lead_ids: missed.map((r) => r.lead_id),
                    });
                    stats.rowsFailed += missed.length;
                  }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                stats.errors.push(`ai: ${msg.slice(0, 200)}`);
                await supabaseAdmin.rpc("fail_deep_scoring_admin", {
                  p_job_id: jobId,
                  p_lead_ids: jobRows.map((r) => r.lead_id),
                });
                stats.rowsFailed += jobRows.length;
              }
            }

            stats.batches += 1;
            await new Promise((r) => setTimeout(r, LOOP_DELAY_MS));
          }

          return Response.json({ ok: true, elapsed_ms: Date.now() - startedAt, ...stats });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("deep-scoring-tick failed", err);
          return Response.json(
            { ok: false, error: message.slice(0, 500), ...stats },
            { status: 500 },
          );
        }
      },
    },
  },
});

async function scoreBatchWithAi(rows: ClaimedRow[], apiKey: string): Promise<AiScore[]> {
  // All rows in a single AI call share the same seller context (job).
  const sellerContext = rows[0]?.context ?? "";

  const compact = rows.map((l) => ({
    id: l.lead_id,
    name: [l.first_name, l.last_name].filter(Boolean).join(" ") || "—",
    title: l.title ?? "",
    location: [l.city, l.state, l.country].filter(Boolean).join(", "),
    company: l.org_name ?? "",
    industry: l.org_industry ?? "",
    headcount: l.org_employee_count ?? "",
    tech: l.org_technologies_used ?? "",
    description: (l.org_description ?? "").slice(0, 400),
    fast_score: l.prior_score ?? 0,
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
Use only "strong" / "partial" / "weak" / "unknown" for verdicts. Cite evidence from the prospect's title, industry, headcount, tech, or description. Do not inflate.

PROSPECTS:
${JSON.stringify(compact)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(40_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 6000,
    }),
  });

  if (res.status === 429) throw new Error("AI rate limit");
  if (res.status === 402) throw new Error("AI credits exhausted");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gateway ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = await res.json();
  const content: string = payload.choices?.[0]?.message?.content ?? "{}";
  const parsed = extractJson(content) as { scores?: AiScore[] };

  const allowed: Verdict[] = ["strong", "partial", "weak", "unknown"];
  const validIds = new Set(rows.map((r) => r.lead_id));
  return (parsed.scores ?? [])
    .map((s: any) => ({
      leadId: String(s.leadId),
      score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 0))),
      reasoning: String(s.reasoning ?? "").slice(0, 400),
      signals: Array.isArray(s.signals)
        ? s.signals
            .filter((x: any) => x && typeof x === "object")
            .map((x: any) => ({
              label: String(x.label ?? "").slice(0, 60),
              verdict: (allowed.includes(x.verdict) ? x.verdict : "unknown") as Verdict,
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
    .filter((s) => validIds.has(s.leadId));
}

// Tolerant JSON extractor — mirrors the one in src/lib/score.functions.ts.
function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  s = s.slice(start);
  const tryParse = (txt: string) => JSON.parse(txt);
  try {
    return tryParse(s);
  } catch {}
  let cleaned = s
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  try {
    return tryParse(cleaned);
  } catch {}
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
        return tryParse(cleaned.slice(0, lastGoodEnd + 1) + "]}");
      }
    }
  }
  throw new Error("Unrecoverable JSON");
}
