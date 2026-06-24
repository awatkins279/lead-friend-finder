import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_FILTERS_SCHEMA, buildLeadQuery } from "@/lib/lead-filters";

// Hard cap. We fetch one extra so the UI can detect "more than the cap".
const MAX_BULK = 50000;

const Input = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  // Caller can request fewer (e.g. Advanced Selection of 1,000), but never more.
  limit: z.number().int().min(1).max(MAX_BULK + 1).optional(),
});

/**
 * Returns matching lead IDs in ONE call, capped at MAX_BULK + 1.
 *
 * No keyset pagination, no ORDER BY id — the planner can stream rows from the
 * cheapest filter index and stop as soon as it hits the LIMIT. This avoids the
 * "canceling statement due to statement timeout" we got when paginating 10k at
 * a time through a filtered scan.
 *
 * The client uses `ids.length` as the displayable matching count
 * (`50,000+` when the result is capped). Selection just turns the same array
 * into a Set — no second round-trip and no credit charge for picking checkboxes.
 */
export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { filters } = data;
    const limit = Math.min(data.limit ?? MAX_BULK + 1, MAX_BULK + 1);

    const { data: payload, error } = await supabaseAdmin.rpc("match_lead_ids_for_people_search", {
      p_user_id: userId,
      p_filters: filters,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);

    const result = (payload ?? {}) as { ids?: unknown; capped?: unknown };
    const ids = Array.isArray(result.ids) ? result.ids.filter((id): id is string => typeof id === "string") : [];
    return { ids, capped: result.capped === true };
  });
