import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FiltersSchema = z.object({
  titles: z.array(z.string().max(200)).max(50).optional().default([]),
  company: z.string().max(200).optional().default(""),
  industry: z.string().max(200).optional().default(""),
  location: z.string().max(200).optional().default(""),
  hasPhone: z.boolean().optional().default(false),
  hasEmail: z.boolean().optional().default(false),
});

const Input = z.object({
  filters: FiltersSchema,
  limit: z.number().int().min(1).max(50000),
});

function escapeForOr(v: string) {
  return v.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export const fetchMatchingIdsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
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

      const titles = (filters.titles ?? []).map((t) => t.trim()).filter(Boolean);
      if (titles.length === 1) {
        q = q.ilike("title", `%${titles[0]}%`);
      } else if (titles.length > 1) {
        q = q.or(titles.map((t) => `title.ilike.%${escapeForOr(t)}%`).join(","));
      }
      if (filters.company.trim()) q = q.ilike("org_name", `%${filters.company.trim()}%`);
      if (filters.industry.trim()) q = q.ilike("org_industry", `%${filters.industry.trim()}%`);
      if (filters.location.trim()) {
        const t = filters.location.trim();
        q = q.or(`city.ilike.%${t}%,state.ilike.%${t}%,country.ilike.%${t}%`);
      }
      if (filters.hasPhone) q = q.not("phone", "is", null).neq("phone", "");
      if (filters.hasEmail) q = q.not("email", "is", null).neq("email", "");

      q = q.range(offset, offset + take - 1);

      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (rows ?? []) as { id: string }[];
      if (batch.length === 0) break;
      for (const r of batch) ids.push(r.id);
      offset += batch.length;
      if (batch.length < take) break;
    }

    return { ids };
  });
