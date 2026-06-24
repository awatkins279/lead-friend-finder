import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_FILTERS_SCHEMA } from "@/lib/lead-filters";

// Hard cap. We fetch one extra so the UI can detect "more than the cap".
const MAX_BULK = 50000;

const PageInput = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  page: z.number().int().min(0).max(100000).optional().default(0),
  pageSize: z.number().int().min(1).max(200).optional().default(25),
});

const IdsInput = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  limit: z.number().int().min(1).max(MAX_BULK + 1).optional(),
});

const CountInput = z.object({ filters: LEAD_FILTERS_SCHEMA });

/**
 * Unified People-Search page fetch. Returns rows for the visible page AND the
 * total match count (capped) in a SINGLE round-trip so the table and the
 * "X matching" header can never disagree.
 */
export const searchLeadsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const offset = data.page * data.pageSize;
    const { data: res, error } = await supabaseAdmin.rpc("search_leads", {
      p_user_id: userId,
      p_filters: data.filters as any,
      p_limit: data.pageSize,
      p_offset: offset,
      p_count_cap: MAX_BULK + 1,
    });
    if (error) throw new Error(error.message);
    const payload = (res ?? {}) as { rows?: any[]; totalCount?: number; capped?: boolean };
    return {
      rows: (payload.rows ?? []) as any[],
      totalCount: Number(payload.totalCount ?? 0),
      capped: Boolean(payload.capped),
    };
  });

/** Just the total match count (capped). Kept for callers that don't need rows. */
export const fetchMatchingCountBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CountInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("search_leads", {
      p_user_id: userId,
      p_filters: data.filters as any,
      p_limit: 0,
      p_offset: 0,
      p_count_cap: MAX_BULK + 1,
    });
    if (error) throw new Error(error.message);
    const payload = (res ?? {}) as { totalCount?: number };
    return { count: Number(payload.totalCount ?? 0) };
  });

/**
 * Returns matching lead IDs capped at MAX_BULK + 1. Uses the unified
 * `search_leads` RPC so the IDs returned exactly match what the visible
 * table is filtering against.
 */
export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = Math.min(data.limit ?? MAX_BULK + 1, MAX_BULK + 1);

    const { data: res, error } = await supabaseAdmin.rpc("search_leads", {
      p_user_id: userId,
      p_filters: data.filters as any,
      p_limit: limit,
      p_offset: 0,
      p_count_cap: limit,
    });
    if (error) throw new Error(error.message);
    const payload = (res ?? {}) as { rows?: Array<{ id?: unknown }>; totalCount?: number; capped?: boolean };
    const ids = (payload.rows ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string");
    return {
      ids,
      totalCount: Number(payload.totalCount ?? ids.length),
      capped: Boolean(payload.capped) || ids.length > MAX_BULK,
    };
  });
