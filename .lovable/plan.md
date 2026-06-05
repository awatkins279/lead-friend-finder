## Email Verification Feature (MillionVerifier)

Add a verification step between pulling leads and adding them to a campaign. Users can verify all emails on a list, see results categorized (deliverable / risky / invalid / unknown), filter by category, and pick which to add to the campaign.

### How it works for the user
1. On a list, click **"Verify Emails"** — runs every lead with an email through MillionVerifier in bulk.
2. Each lead gets a `verification_status` badge: **Deliverable** (green), **Risky** / catch-all (yellow), **Invalid** (red), **Unknown** (gray).
3. Filter chips on the list let the user show only Deliverable, or Deliverable + Risky, etc.
4. Bulk-select filtered leads and add to campaign / enrich / score.
5. Progress bar like scoring jobs ("2,431 / 5,000 verified").

### Credit metering
- New action `verify_email` = **1 credit per email verified** (admins bypass — your dad/uncle/you stay free).
- Charged up front per batch; refunded for any emails the API couldn't process (no result returned).
- Surfaces in the existing credit widget and `get_credit_summary` breakdown.

### Technical details

**Database migration (`list_leads` columns):**
- `verification_status` text — `deliverable | risky | invalid | unknown | disposable | duplicate | null`
- `verification_result` text — raw MillionVerifier result code (`ok`, `catch_all`, `unknown`, `error`, etc.)
- `verification_quality` text — `good | risky | bad` (MV's quality field)
- `verified_at` timestamptz
- Index on `(list_id, verification_status)` for fast filtering.

**Background job (mirrors scoring_jobs pattern):**
- New tables `verification_jobs` + `verification_job_batches` (batched 100 emails per MV bulk request).
- `claim_verification_batch` / `bump_verification_job_counters` / `finalize_verification_job` RPCs — copy of the scoring pattern so it survives worker timeouts and resumes.
- Worker calls MillionVerifier bulk API, writes results back to `list_leads`.

**Server functions (`src/lib/verification.functions.ts`):**
- `startVerificationJob({ listId })` — charges credits, creates batches, returns job id.
- `processVerificationBatch({ jobId })` — claims a batch, calls MV, updates rows. Loop driver same as scoring.
- `getVerificationJobStatus({ jobId })`.

**Secret needed:** `MILLIONVERIFIER_API_KEY` (one platform-wide key, you pay MV, end users pay you in platform credits).

**UI changes (`src/routes/app.lists.$listId.tsx`):**
- "Verify Emails" button next to existing Score / Enrich buttons.
- Progress toast/banner during the job.
- Status badge column on the leads table.
- Filter chips: All / Deliverable / Risky / Invalid / Unverified.
- Bulk action ("Add to campaign") respects the active filter.

**MillionVerifier mapping:**
- `ok` → deliverable
- `catch_all` → risky
- `unknown` → unknown
- `disposable` → disposable (treated as invalid for filtering)
- `invalid` / `error` → invalid

### Out of scope (ask later)
- Auto-verify on send (you said "no" — bulk on-demand only).
- Re-verification cadence (cached forever until user re-runs).
- Per-plan caps on verification credits (works with existing plan credit pool).

### What I need from you before building
Confirm and I'll request the **`MILLIONVERIFIER_API_KEY`** secret, then build.