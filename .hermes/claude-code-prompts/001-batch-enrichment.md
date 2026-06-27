# Claude Code Prompt: Batch Enrichment for 50K+ Lead Speed

## Context

The `enrichLead` function in `src/lib/enrich.functions.ts` processes ONE lead per AI call.
For 50,000 leads with 5 concurrent workers, this takes ~11 hours.
The scoring system already batches 250 leads per AI call in `scoring-jobs.functions.ts:scoreBatch`.
Enrichment should follow the same pattern.

## What to change

### 1. Create `enrichLeadsBatch` in `src/lib/enrich.functions.ts`

Create a new server function that processes MULTIPLE leads in a single AI call:

```typescript
export const enrichLeadsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        listId: z.string().uuid(),
        leadIds: z.array(z.string().min(1)).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Fetch list config once
    // Fetch all leads in one query
    // Build ONE prompt with all leads
    // AI generates emails for all leads in one response
    // Update all list_leads rows in one batch
    // Return results
  });
```

### 2. Update the frontend `runAll` in `src/routes/app.lists.$listId.tsx`

Change `runAll` (line 349) to batch leads into groups of 50-100 and call `enrichLeadsBatch` instead of `enrichLead` one-by-one:

- Split `pending` leads into chunks of 50
- Call `enrichLeadsBatch` for each chunk
- Keep CONCURRENCY=5 for parallel chunk processing
- This gives: 50 leads × 5 concurrent × ~4s = 250 leads per ~4 seconds vs current 5 leads per ~4 seconds

### 3. Acceptance criteria

- Build passes: `bun run build`
- A campaign with 100 leads should generate all sequences in under 10 seconds
- Scoring and research data must still populate correctly per lead
- Credits billed correctly (1 credit per lead, not per batch)
- Progress bar in UI updates per-batch, not per-lead

### 4. Files involved

- `src/lib/enrich.functions.ts` — create `enrichLeadsBatch`
- `src/routes/app.lists.$listId.tsx` — update `runAll` to use batching
- Optional: `src/components/CampaignConfigDialog.tsx` — no changes needed

### 5. Key details for the AI prompt structure

- Use the same list config (what_selling, sender_name, num_emails, etc.) for all leads in the batch
- Compact lead data like `scoreBatch` does (name, title, location, company, industry, etc.)
- Return JSON with `{ results: [{ leadId, score, reasoning, emails, ... }] }`
- Use `google/gemini-2.5-flash` model (same as current enrichLead)
- Handle partial failures gracefully — if AI fails for one lead, don't lose the others
