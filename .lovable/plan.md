## Goal
Make large lead operations fast and reliable: select and score at least 70,000 leads, remove the AI Operator’s 1,000/20,000 caps, and accelerate scoring, validation, and email generation without losing work to request timeouts.

## What I found
- People Search is capped at **50,000**, its server lookup also rejects anything above 50,000, and scoring jobs reject more than **20,000** IDs.
- The AI Operator independently clamps each run to **20,000** and defaults the blueprint to **1,000**, divided across campaign plays.
- Detailed AI scoring processes only **15 leads per model call**. Current worker fan-out cannot reach 1,000 leads in 10 seconds and is constrained by model latency/rate limits.
- The scheduled worker is effectively firing once per minute in production; multiple requests arrive together instead of providing steady throughput.
- Operator validation advances only **25 emails per worker pass** and outreach generation only **4 leads per pass**.
- Large qualified/deliverable lead arrays are stored inside one operator event JSON object. That will become slow and unsafe at 70,000 leads.
- Database capacity is healthy; the bottleneck is the current workflow architecture and model-call pattern, not connection saturation.

## Implementation plan

### 1. Replace per-lead AI-first scoring with hybrid fast scoring
- Use one AI call at job creation to translate the user’s seller context into a compact scoring rubric: target titles, industries, company sizes, geography, technologies, positive signals, and exclusions.
- Apply that rubric in bulk to all selected leads with deterministic database-side scoring, producing a score and concise evidence quickly.
- Target **1,000 initial scores in about 10 seconds** under normal database load; report measured throughput rather than falsely promising a hard external-service SLA.
- Queue only the strongest/ambiguous candidates for optional AI deep scoring and detailed reasoning. Initial scores remain immediately usable while deeper results improve asynchronously.
- Preserve retries, cancellation, progress, and completed results if a worker fails.

### 2. Support 70,000+ lead selections safely
- Raise the People Search selection and campaign-add limit to **100,000**, covering the requested 70,000-lead workflow.
- Stop sending giant ID arrays from the browser when “all matching” or a large numeric selection is used. Create the scoring job server-side from the saved filters and requested count, paging IDs directly into job batches.
- Keep explicit manually selected IDs supported for smaller selections.
- Update UI copy, validation, counters, and progress so large selections are clear and responsive.

### 3. Remove AI Operator audience caps
- Remove the 20,000 clamp and the implicit 1,000 default from operator execution.
- Honor the approved blueprint’s requested audience up to the new 100,000 operational ceiling, without dividing the total incorrectly across plays.
- Have each play use its own estimated/approved audience while enforcing the overall blueprint guardrail.
- Stream matched leads into scoring batches instead of loading and retaining the entire audience in one in-memory response.

### 4. Normalize large operator pipeline state
- Keep operator events lightweight: stage, totals, cursors, current action, and progress only.
- Store qualification, validation, and generation state on durable lead/job rows rather than embedding tens of thousands of records in event JSON.
- Add targeted job/claim indexes and atomic claim functions so concurrent workers do not duplicate work.
- Maintain the existing live operator screen using these lightweight counters and activity messages.

### 5. Accelerate validation and email generation
- Add dedicated durable queues for validation and outreach generation rather than advancing four leads on each scoring tick.
- Process validation in provider-safe concurrent batches with adaptive backoff.
- Generate the campaign’s core sequence once, then batch-personalize concise lead-specific sections for qualified contacts instead of generating an entire sequence independently for every lead.
- Bulk-write generated results and expose separate progress for scoring, deep scoring, validation, and email generation.
- Keep regeneration supported and ensure a retry updates only failed/stale items.

### 6. Fix worker scheduling and concurrency
- Replace the current bursty once-per-minute behavior with steady authenticated worker invocations and separate worker budgets per task type.
- Use `SKIP LOCKED` claims, stale-job recovery, retry limits, adaptive rate-limit backoff, and strict per-request deadlines.
- Prevent browser workers and scheduled workers from overloading the same jobs while still allowing processing to continue after the tab closes.

### 7. Verify at production scale
- Test selection/job creation at 1,000, 20,000, and 70,000 leads.
- Benchmark initial hybrid scoring throughput and display actual leads/second and estimated completion time.
- Confirm the operator is no longer capped at 1,000 or 20,000, jobs resume after interruption, and no leads are duplicated or skipped.
- Test email generation retries/regeneration and confirm progress continues with the browser closed.

## Technical changes
- Update People Search, bulk matching, scoring server functions, operator build/execution, and worker routes.
- Add database migrations for normalized queue/state fields, atomic claim functions, and indexes; preserve existing access controls.
- Keep the current detailed AI score as the optional deep-scoring layer, while the database-driven first pass provides the requested speed.