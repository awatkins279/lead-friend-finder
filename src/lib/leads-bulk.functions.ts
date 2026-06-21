import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chargeUser } from "@/lib/credits.functions";
import { LEAD_FILTERS_SCHEMA, buildLeadQuery } from "@/lib/lead-filters";

const Input = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  // 10k pages: the underlying PK index scan returns 10k rows in ~10ms server-side,
  // and a 50k selection now needs only 5 round-trips instead of 50.
  limit: z.number().int().min(1).max(10000),
  afterId: z.string().min(1).nullable().optional(),
});

export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { filters, limit, afterId } = data;

    let q: any = supabaseAdmin
      .from("leads")
      .select("id")
      .or(`imported_by.is.null,imported_by.eq.${userId}`);

    // Keyset pagination (id > afterId) keeps every request small. Returning
    // 100k IDs from one server action can exceed runtime/response limits, so
    // the client asks for repeated 1k pages instead.
    q = buildLeadQuery(q, filters);
    if (afterId) q = q.gt("id", afterId);
    q = q.order("id", { ascending: true }).limit(limit);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const ids = ((rows ?? []) as { id: string }[]).map((row) => row.id);
    const nextCursor = ids.length > 0 ? ids[ids.length - 1] : null;

    // Meter pulled contacts (admin bypass automatic)
    if (ids.length > 0) {
      await chargeUser(userId, "pull_contacts", ids.length, `bulk_pull:${ids.length}`);
    }

    return { ids, nextCursor };
  });
