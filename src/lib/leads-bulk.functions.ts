import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chargeUser } from "@/lib/credits.functions";
import { LEAD_FILTERS_SCHEMA, buildLeadQuery } from "@/lib/lead-filters";

const Input = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  limit: z.number().int().min(1).max(100000),
});

export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { filters, limit } = data;

    // Keyset pagination (id > lastId) rather than offset/range. With 1.5M rows
    // and trigram ilike filters, deep `.range()` offsets force Postgres to scan
    // and discard everything before the offset on each chunk — which trips the
    // statement timeout on "select all matching". Keyset uses the PK index and
    // stays O(chunk) regardless of how deep we are.
    const CHUNK = 1000;
    const ids: string[] = [];
    let lastId: string | null = null;

    while (ids.length < limit) {
      const take = Math.min(CHUNK, limit - ids.length);
      let q: any = supabase.from("leads").select("id");

      // Single source of truth — shared with the in-app People Search list.
      q = buildLeadQuery(q, filters);
      if (lastId) q = q.gt("id", lastId);
      q = q.order("id", { ascending: true }).limit(take);

      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (rows ?? []) as { id: string }[];
      if (batch.length === 0) break;
      for (const r of batch) ids.push(r.id);
      lastId = batch[batch.length - 1].id;
      if (batch.length < take) break;
    }

    // Meter pulled contacts (admin bypass automatic)
    if (ids.length > 0) {
      await chargeUser(userId, "pull_contacts", ids.length, `bulk_pull:${ids.length}`);
    }

    return { ids };
  });
