# People Search Rebuild

## Why this keeps breaking

There are two parallel filter implementations:

- **SQL** — `match_lead_ids_for_people_search` and `count_leads_for_people_search` (used by the total count and "select all matching")
- **TypeScript** — `buildLeadQuery` in `src/lib/lead-filters.ts` (used by the visible 25-row page)

Every fix has had to be made in both places, so they drift. Company-size buckets are the worst offender: the source data has values like `"1 to 10"`, `"11 to 25"`, `"11 to 50"`, `"26 to 50"`, `"51 to 200"`, etc., and any lead with a "wide" range (e.g. `"11 to 50"`) belongs to multiple UI buckets but lives in none of them as soon as a narrow bucket is selected. Same problem for locations stored as either `"FL"` or `"Florida"`.

The rebuild collapses both paths into one, moves the messy normalization out of query time, and leaves scoring as a clean separate step.

## What changes

### 1. Normalize lead data once, at write time

Add three derived columns to `leads`, populated by a trigger:

- `employee_min int`, `employee_max int` — parsed from `org_employee_count` ("11 to 50" → 11/50, "10001+" → 10001/null, "1" → 1/1)
- `location_tokens text[]` — lowercased set including city, state (both abbreviation and full name), and country, so `"FL"` and `"Florida"` always match the same rows

Backfill once for existing rows. After this, filter logic is trivial integer/array comparisons — no per-query string gymnastics.

### 2. One RPC, one filter contract

Replace `match_lead_ids_for_people_search`, `count_leads_for_people_search`, and `buildLeadQuery` with a single RPC `search_leads(p_user_id, p_filters, p_limit, p_offset, p_sort)` that returns `{ rows, total_count, capped }`.

- Server function `searchLeads({ filters, page, pageSize })` — drives the 25-row table
- Server function `selectAllMatchingIds({ filters, cap })` — drives "Select all matching", same RPC with `select_ids_only=true`

Both the page and the bulk-select call the same SQL. They cannot drift again because there is no second implementation.

Filter combination rule: **OR within a group, AND across groups** (your choice). The RPC enforces this explicitly:

```text
(size in selected buckets) AND (title ILIKE ANY selected) AND (location_tokens && selected) AND ...
```

### 3. Indexes that match the new shape

- `(imported_by, employee_min, employee_max)` — covers size filtering on the public-leads path
- GIN on `location_tokens` — array overlap
- Existing GIN trigram indexes on `title`, `org_name`, `org_industry` stay

Counts come from a single aggregate over the index, no UNION ALL.

### 4. UI cleanup in `src/routes/app.people.tsx`

- Replace the two data-fetch paths with `useSuspenseQuery(searchLeads)` for the table and a lazy `useMutation(selectAllMatchingIds)` triggered only when the user clicks "Select all matching".
- Total count comes back inside the same response — no second round-trip, no "25 vs 159,944" disagreement possible.
- Filter state, debouncing, and the size/location/title chips are kept as-is; only the data layer changes.

### 5. Scoring hand-off (stub now, fill in when you send the prompt)

The scoring entry point becomes a single server function `scoreSelectedLeads({ leadIds, rubric })` that:

1. Inserts a `scoring_jobs` row + batches (250 IDs per batch) — already how it works today
2. Workers call `process_fast_scoring_batch_admin` (already exists)
3. The page polls job progress

I'll wire the People Search "Score selected" button to this single entry point. The rubric/prompt is a placeholder until you send me the detailed scoring prompt — at that point I only need to update the rubric shape and the SQL scoring formula inside `process_fast_scoring_batch_admin`. No more UI/query changes needed.

## Out of scope

- Filter UI design and chips (untouched)
- Lead import pipeline (untouched, except adding the trigger that fills the new columns)
- Existing scoring worker/queue (kept; only the rubric will change later)

## Migration order

1. Add columns + trigger + backfill (one migration)
2. Add indexes (second migration)
3. New `search_leads` RPC + grants (third migration)
4. Swap server functions + UI to call it
5. Delete the old RPCs and `buildLeadQuery` once nothing references them

## Risk

The backfill on `leads` will touch every row once. It runs inside the migration and will lock-step through the table — for ~16k–500k rows this is fast (seconds). I'll confirm row count before running.

## Open item

Send me the scoring prompt whenever you're ready — I'll fold it into step 5 (or a follow-up) without touching search again.
