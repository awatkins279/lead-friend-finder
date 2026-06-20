import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const importedLeadSchema = z.object({
  first_name: z.string().trim().max(200).optional().default(""),
  last_name: z.string().trim().max(200).optional().default(""),
  // Keep malformed addresses so the lead can still be scored; the separate
  // email-validation step is responsible for classifying them as invalid.
  email: z.string().trim().max(320).optional().default(""),
  title: z.string().trim().max(300).optional().default(""),
  company: z.string().trim().max(300).optional().default(""),
  industry: z.string().trim().max(300).optional().default(""),
  company_size: z.string().trim().max(100).optional().default(""),
  city: z.string().trim().max(200).optional().default(""),
  state: z.string().trim().max(200).optional().default(""),
  country: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(100).optional().default(""),
  linkedin_url: z.string().trim().max(1000).optional().default(""),
  company_website: z.string().trim().max(1000).optional().default(""),
  company_description: z.string().trim().max(4000).optional().default(""),
});

const importInput = z.object({
  leads: z.array(importedLeadSchema).min(1).max(5000),
});

export const importLeadsForScoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const seenEmails = new Set<string>();
    const rows = data.leads
      .filter((lead) => lead.first_name || lead.last_name || lead.email || lead.company)
      .filter((lead) => {
        const email = lead.email.toLowerCase();
        if (!email) return true;
        if (seenEmails.has(email)) return false;
        seenEmails.add(email);
        return true;
      })
      .map((lead) => ({
        id: crypto.randomUUID(),
        imported_by: context.userId,
        first_name: lead.first_name || null,
        last_name: lead.last_name || null,
        email: lead.email.toLowerCase() || null,
        title: lead.title || null,
        org_name: lead.company || null,
        org_industry: lead.industry || null,
        org_employee_count: lead.company_size || null,
        city: lead.city || null,
        state: lead.state || null,
        country: lead.country || null,
        phone: lead.phone || null,
        linkedin_url: lead.linkedin_url || null,
        org_website_url: lead.company_website || null,
        org_description: lead.company_description || null,
      }));

    if (rows.length === 0) throw new Error("The file did not contain any usable leads");

    const ids: string[] = [];
    const warnings: { batch: number; error: string }[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const batchNum = Math.floor(i / 500) + 1;
      const slice = rows.slice(i, i + 500);
      const { data: inserted, error } = await supabaseAdmin
        .from("leads")
        .insert(slice)
        .select("id");
      // Don't abort the whole import on one bad batch — record it and keep going,
      // otherwise a single failure mid-way leaves a partial import with no report.
      if (error) {
        warnings.push({ batch: batchNum, error: error.message });
        continue;
      }
      ids.push(...(inserted ?? []).map((row) => row.id));
    }

    // Only hard-fail if NOTHING imported; otherwise return partial success.
    if (ids.length === 0) {
      throw new Error(
        warnings[0]?.error
          ? `No leads could be imported: ${warnings[0].error}`
          : "No leads could be imported",
      );
    }

    return {
      ids,
      imported: ids.length,
      warnings: warnings.length ? warnings : undefined,
    };
  });
