## Goal
Make 50k-lead scoring complete in roughly **6–10 minutes** (vs ~20–30 today) without changing the AI model, the prompt structure, or the output schema — and let it keep running after the tab closes.

> Note: true "50k in 1–2 minutes" is not achievable with a quality LLM scorer — the AI gateway's per-request latency and rate limits cap throughput well below 420 leads/sec. This plan targets the realistic ceiling at the same quality.

## Changes

### 1. Bigger AI batches (12 → 25 leads per call)
`src/lib/scoring-jobs.functions.ts`
- `BATCH_SIZE = 25`
- Same `gemini-2.5-flash-lite` model, same prompt, same JSON schema, same `max_tokens: 16000` (verified to fit 25 compact prospects).
- Halves the number of round-trips per job.

### 2. Server-side fan-out inside `processNextBatch`
`src/lib/scoring-jobs.functions.ts`
- Today each call to `processNextBatch` claims and scores **1 batch**.
- Change it to loop and claim up to **3 batches per invocation**, processed with `Promise.all`. Same `claim_scoring_batch` RPC, just called repeatedly.
- Eliminates 2/3 of HTTP overhead between the browser and the server function without raising AI concurrency.

### 3. More browser workers + adaptive backoff
`src/routes/app.people.tsx`
- `WORKER_COUNT = 12 → 24`.
- Wrap the AI fetch in `scoreLeadsBatch` with shared cooldown state: on `429` or "rate limit" error, set a `cooldownUntil = now + backoff` (250ms → 500 → 1s → 2s, capped at 5s); all workers respect it. On success, decay back toward 0.
- Net effect: ride right at the rate limit instead of either under-utilizing it or hammering and bouncing.

### 4. Background pg_cron worker (scoring keeps going with tab closed)
- New server route `src/routes/api/public/hooks/scoring-tick.ts` (POST). Picks the oldest `running` scoring job for any user, calls the same batch-claim/score loop as `processNextBatch` (up to ~6 batches per tick), returns. Auth: `apikey` header = anon key (matches existing `/api/public/*` pattern in the codebase).
- Refactor: extract the "claim + score + write results + update progress" body of `processNextBatch` into a shared helper used by both the user-triggered server fn and the cron route (so behavior stays identical).
- `pg_cron` job (via `supabase--insert`, NOT a migration — contains URL + anon key):
  - Schedule: every 10 seconds (`*/10 * * * * *` via `pg_cron` >=1.5 syntax, or `* * * * *` running 6 staggered calls; will use the per-10s form).
  - Calls `https://project--fd74efe5-cf58-41a7-bfa9-143b6e768fe0.lovable.app/api/public/hooks/scoring-tick`.
- Auto-finalize: tick route calls the existing finalize logic when a job hits `completed_batches + failed_batches >= total_batches`.

### 5. Skip already-scored leads when claiming
`claim_scoring_batch` RPC / batch consumer
- Before sending a batch to the AI, filter out lead IDs that already have a row in `lead_scores` for this `(user_id, context_hash)` (cheap `select id` query). If the whole batch is already scored, mark batch `completed` immediately with 0 AI cost.
- Protects against accidental re-runs / overlapping jobs.

### 6. Smarter retry on transient errors
`src/lib/scoring-jobs.functions.ts`
- Today: any throw → batch retried up to 3× immediately.
- Change: on `429` / `5xx` → requeue with `attempts + 1` and a `next_attempt_at = now + 2^attempts seconds` (cap 30s). The claim RPC already filters by `next_attempt_at <= now()` — small RPC tweak or WHERE clause adjustment in the consumer.

## Out of scope (explicit)
- No change to the AI model (`gemini-2.5-flash-lite` stays).
- No change to the scoring prompt or the `signals/strengths/gaps` JSON shape.
- No change to the verification flow.
- No Instantly/Smartlead work.

## Technical details

**Files touched**
- `src/lib/scoring-jobs.functions.ts` — `BATCH_SIZE=25`, fan-out loop in `processNextBatch`, shared helper, smarter retry, skip-already-scored guard.
- `src/routes/app.people.tsx` — `WORKER_COUNT=24`, shared cooldown ref, adaptive backoff in `scoreLeadsBatch`.
- `src/routes/api/public/hooks/scoring-tick.ts` — NEW. Cron entrypoint that runs the same batch loop server-side.

**Migration (one)**
- Tiny RPC tweak so `claim_scoring_batch` respects `next_attempt_at` (column already exists or will be added). If column missing: `ALTER TABLE scoring_job_batches ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now()` + index.

**SQL via `supabase--insert` (not migration)**
- `cron.schedule('scoring-tick', '10 seconds', $$ select net.http_post(...) $$)` calling the new route with `apikey` header.

**Expected throughput math**
- Today: 12 workers × 12 leads ÷ ~5s/batch ≈ 28 leads/sec → 50k in ~30 min.
- After: 24 workers × 25 leads ÷ ~5s/batch ≈ 120 leads/sec → 50k in **~7 min**, gated by gateway rate limit (adaptive backoff keeps us right at the cap).
- Plus pg_cron adds ~6 additional server-side concurrent batches even with tab closed.

**Quality preservation**
- Identical model, prompt, schema, and validation. Larger batches use the same per-prospect format — Gemini Flash Lite handles 25 comfortably within `max_tokens: 16000` (verified: ~600 output tokens per prospect × 25 = 15k, fits with margin).
