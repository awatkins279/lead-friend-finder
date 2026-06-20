import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chargeUser } from "@/lib/credits.functions";
import { LEAD_FILTERS_SCHEMA, buildLeadQuery } from "@/lib/lead-filters";

const FiltersSchema = z.object({
  name: z.string().max(200).optional().default(""),
  titles: z.array(z.string().max(200)).max(50).optional().default([]),
  company: z.string().max(200).optional().default(""),
  industry: z.string().max(200).optional().default(""),
  location: z.string().max(200).optional().default(""),
  companySize: z.array(z.string().max(50)).max(20).optional().default([]),
  hasPhone: z.boolean().optional().default(false),
  hasEmail: z.boolean().optional().default(false),
});

const SIZE_BUCKETS: Record<string, string[]> = {
  "1-10": ["1", "1 to 10", "2 to 10"],
  "11-25": ["11 to 25", "11 to 50"],
  "26-50": ["26 to 50", "11 to 50"],
  "51-100": ["51 to 100", "51 to 200"],
  "101-250": ["101 to 250", "51 to 200", "201 to 500"],
  "251-500": ["251 to 500", "201 to 500"],
  "501-1000": ["501 to 1000", "501 to 1,000"],
  "1001-2500": ["1001 to 5000", "1,001 to 5,000"],
  "2501-5000": ["1001 to 5000", "1,001 to 5,000"],
  "5000+": ["5001 to 10000", "5,001 to 10,000", "10000+", "10001+", "10,001+"],
};

const Input = z.object({
  filters: LEAD_FILTERS_SCHEMA,
  limit: z.number().int().min(1).max(100000),
});


function escapeForOr(v: string) {
  return v.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { filters, limit } = data;

    // Page through the filtered result set in API-safe chunks. For text-filtered
    // searches, forcing ORDER BY id made Postgres sort every matching row before
    // returning the first page, which is what hit statement timeouts.
    const CHUNK = 1000;
    const ids: string[] = [];
    let offset = 0;

    while (ids.length < limit) {
      const take = Math.min(CHUNK, limit - ids.length);
      let q: any = supabase.from("leads").select("id");

      // Single source of truth — shared with the in-app People Search list.
      q = buildLeadQuery(q, filters);

      q = q.range(offset, offset + take - 1);

      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (rows ?? []) as { id: string }[];
      if (batch.length === 0) break;
      for (const r of batch) ids.push(r.id);
      offset += batch.length;
      if (batch.length < take) break;
    }

    // Meter pulled contacts (admin bypass automatic)
    if (ids.length > 0) {
      await chargeUser(userId, "pull_contacts", ids.length, `bulk_pull:${ids.length}`);
    }

    return { ids };
  });
