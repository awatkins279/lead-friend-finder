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

const CountInput = z.object({
  filters: LEAD_FILTERS_SCHEMA,
});

function scopedLeadQuery(supabaseAdmin: any, userId: string, select: string, options?: any) {
  return supabaseAdmin
    .from("leads")
    .select(select, options)
    .or(`imported_by.is.null,imported_by.eq.${userId}`);
}

export const fetchMatchingCountBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CountInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: count, error } = await supabaseAdmin.rpc("count_leads_for_people_search", {
      p_user_id: userId,
      p_filters: data.filters,
    });
    if (error) throw new Error(error.message);
    return { count: Number(count ?? 0) };
  });

/**
 * Returns matching lead IDs capped at MAX_BULK + 1.
 *
 * This deliberately reuses the same TypeScript filter builder as the visible
 * table. The previous database RPC had its own company-size mapping, so the
 * displayed rows/count and "Select matching" could disagree.
 */
export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { filters } = data;
    const limit = Math.min(data.limit ?? MAX_BULK + 1, MAX_BULK + 1);
    const ids: string[] = [];

    for (let from = 0; from < limit; from += 1000) {
      const to = Math.min(from + 999, limit - 1);
      let q: any = scopedLeadQuery(supabaseAdmin, userId, "id")
        .order("id", { ascending: true })
        .range(from, to);
      q = buildLeadQuery(q, filters);

      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);

      const pageIds = (rows ?? [])
        .map((row: { id?: unknown }) => row.id)
        .filter((id: unknown): id is string => typeof id === "string");
      ids.push(...pageIds);
      if (pageIds.length < to - from + 1) break;
    }

    return { ids, totalCount: ids.length, capped: ids.length > MAX_BULK };
  });
