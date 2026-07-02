# Claude Code Prompt: Scoring System Overview

Reference doc describing how the lead scoring system was built and what data it uses. Paste this into Claude Code as context when extending scoring, adding new signals, or wiring in enrichment.

## Architecture

The scoring system has two layers:

### 1. Interactive scoring — `src/lib/score.functions.ts`
- `createServerFn` gated by `requireSupabaseAuth`.
- Input: up to 25 lead IDs + free-form seller context (what we're selling / ICP).
- Pulls lead rows from Supabase, builds a compact JSON payload, sends ONE call to Lovable AI Gateway (`google/gemini-2.5-flash`) with `response_format: json_object`.
- Strict rubric in the system prompt: 90+ obvious ICP, 70–89 strong, 40–69 weak, <40 wrong profile. "Be ruthless, do not inflate."
- Returns per-lead: `score`, `reasoning`, `signals[]` (6 dimensions: industry fit, size fit, role relevance, pain alignment, tech/buying signal, geo/timing — each verdict `strong|partial|weak|unknown` + short evidence note), `strengths[]`, `gaps[]`.
- Tolerant JSON extractor (`extractJson`) strips markdown fences, repairs trailing commas, and closes truncated `scores[]` arrays so a partial AI response still yields usable rows.
- Credits are charged ONLY after a successful AI run + parse via `chargeUser(userId, "generate_email", n)`. Failed fetch / bad JSON = no charge. Admin accounts bypass.

### 2. Background scoring — `src/lib/scoring-jobs.functions.ts`
- pg_cron ticks hit `/api/public/hooks/scoring-tick` and `/api/public/hooks/deep-scoring-tick`.
- Fast worker: pure SQL heuristic for cheap first-pass triage across large lists.
- Deep worker: batches 250 leads per AI call (same model, same rubric), claims rows via `status = 'processing'` with a stale-lock reclaim so nothing sits stuck.
- Same JSON extractor + normalization as the interactive fn, so UI renders identically regardless of entry point.
- Workers are idempotent — safe under overlapping pg_cron runs.

## What data feeds the AI

The scoring functions do NOT fetch new info about prospects. They reason purely over columns already stored in the `leads` table from the original People Search import:

- `first_name`, `last_name`, `title`
- `city`, `state`, `country`
- `org_name`, `org_industry`, `org_employee_count`
- `org_technologies_used`
- `org_description` (truncated to 400 chars to keep prompts small)

No live web lookup, no LinkedIn scrape, no enrichment call at scoring time. If a lead row is sparse (missing `org_description` or `org_technologies_used`), the AI legitimately returns `"unknown"` for those dimensions — by design, not a bug.

Related but separate:
- **Enrichment** (`src/lib/enrich.functions.ts`) — AI email sequence generation, uses the same lead columns but does not write back to them.
- **Verification** (`lead_verifications`) — email deliverability only, not used by scoring.

## Design goals (preserve when extending)

1. Never bill on failure — charge after successful parse only.
2. Never leave rows stuck — stale-lock reclaim on `processing` rows.
3. Identical rubric across all three entry points (interactive, fast worker, deep worker) so scores are comparable.
4. Idempotent workers — pg_cron overlap is safe.
5. Tolerant JSON parsing — a partial AI response should still yield usable rows.

## If you extend scoring

- Adding a new signal dimension → update the system prompt rubric in BOTH `score.functions.ts` and `scoring-jobs.functions.ts`, and widen the `signals[]` normalization cap (currently `.slice(0, 8)`).
- Adding richer lead evidence (e.g. LinkedIn summary, recent funding) → add columns to `leads`, populate at enrichment time, then extend the `compact` payload in both scoring paths.
- Never send full raw rows to the AI — always project to a compact object; the 250-batch deep worker is prompt-size sensitive.
