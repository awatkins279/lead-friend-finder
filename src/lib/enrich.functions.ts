import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatCompletion } from "@/lib/ai-client";

const inputSchema = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
});

const DEFAULT_UNSUB_FOOTER =
  "If you'd rather not hear from me, just reply \"unsubscribe\" and I'll take you off my list.";

type EmailInSequence = {
  step: number;
  subject: string;
  body: string;
  cta: string;
  send_after_days: number;
};

type IppSignal = {
  label: string;
  verdict: "strong" | "partial" | "weak" | "unknown";
  note: string;
};

type EnrichOutput = {
  score: number;
  reasoning: string;
  pain_points: string[];
  talking_points: string[];
  ipp_breakdown?: IppSignal[];
  emails: EmailInSequence[];
};

// ── Batch enrichment (50 leads per AI call — ~50x faster than one-at-a-time) ──

const batchInputSchema = z.object({
  listId: z.string().uuid(),
  leadIds: z.array(z.string().min(1)).min(1).max(50),
});

type BatchEnrichRow = {
  leadId: string;
  score: number;
  reasoning: string;
  pain_points: string[];
  talking_points: string[];
  ipp_breakdown?: IppSignal[];
  emails: EmailInSequence[];
  error?: string;
};

export const enrichLeadsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => batchInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Fetch campaign config ONCE
    const { data: list, error: listErr } = await supabase
      .from("lists")
      .select(
        "id, name, description, sender_name, sender_title, sender_company, what_selling, key_selling_points, num_emails, word_count, personalization_level, cta_type, extra_instructions",
      )
      .eq("id", data.listId)
      .maybeSingle();
    if (listErr) throw new Error(listErr.message);
    if (!list) throw new Error("List not found");
    if (!list.what_selling || !list.sender_name) {
      throw new Error("Set up the campaign first (sender + what you're selling).");
    }

    const numEmails = Math.max(1, Math.min(10, list.num_emails ?? 4));
    const wordCount = Math.max(40, Math.min(400, list.word_count ?? 150));

    const personalizationGuide: Record<string, string> = {
      low: "Light personalization — mainly use first name and company name.",
      medium: "Medium personalization — reference their role and industry, but keep it efficient.",
      high: "High, hand-written feel — reference 1-2 specific details from their profile or company. Should feel researched, not templated.",
    };

    const ctaGuide: Record<string, string> = {
      auto: "Pick the best CTA per email — vary across the sequence (soft ask, calendar link, quick reply, breakup, etc.).",
      meeting: "Always ask for a 15-min meeting.",
      reply: "Always ask for a simple reply (e.g. 'worth a quick chat?').",
      resource: "Always offer a resource (case study, one-pager, demo video).",
      question: "Always end with a single open-ended question.",
    };

    // 2. Fetch all leads in ONE query
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select(
        "id,first_name,last_name,title,linkedin_url,city,state,country,org_name,org_description,org_industry,org_employee_count,org_technologies_used,org_website_url,email",
      )
      .in("id", data.leadIds);
    if (leadsErr) throw new Error(leadsErr.message);
    if (!leads || leads.length === 0) throw new Error("No leads found");

    // 3. Build compact lead profiles for the batch prompt
    const leadProfiles = leads.map((lead) => {
      const fullName =
        [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";
      const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");
      return [
        `LEAD ${lead.id.slice(-6)}`,
        `Name: ${fullName}`,
        `Title: ${lead.title ?? "—"}`,
        `Location: ${location || "—"}`,
        `Company: ${lead.org_name ?? "—"}`,
        `Industry: ${lead.org_industry ?? "—"}`,
        `Headcount: ${lead.org_employee_count ?? "—"}`,
        `Tech: ${lead.org_technologies_used ?? "—"}`,
        `Description: ${(lead.org_description ?? "—").slice(0, 120)}`,
      ].join(" | ");
    });

    const system = `You are an elite B2B sales copywriter. For each lead below, score fit (0-100), list pain points and talking points, and write a ${numEmails}-email cold sequence. Every email is conversational, plain text, no signature placeholder. Single clear CTA per email. Vary the angle across the sequence — do not repeat the same pitch.`;

    const userPrompt = `CAMPAIGN
Name: ${list.name}
Description: ${list.description ?? "(none)"}
What's being sold: ${list.what_selling}
Key selling points: ${list.key_selling_points ?? "(none)"}
Sender: ${list.sender_name}${list.sender_title ? ", " + list.sender_title : ""}${list.sender_company ? " @ " + list.sender_company : ""}
Sequence length: ${numEmails} emails
Target word count per email: ~${wordCount} words
Personalization: ${personalizationGuide[list.personalization_level] ?? personalizationGuide.high}
CTA strategy: ${ctaGuide[list.cta_type] ?? ctaGuide.auto}
Extra instructions: ${list.extra_instructions ?? "(none)"}

LEADS TO PROCESS (${leads.length} total):
${leadProfiles.join("\n")}

Return a JSON object with a "results" array, one entry per lead:
{
  "results": [
    {
      "leadSuffix": "${leads[0]?.id.slice(-6) ?? "------"}",  // last 6 chars of the lead ID shown above
      "score": 75,
      "reasoning": "1-2 sentence explanation",
      "pain_points": ["3-5 inferred pain points"],
      "talking_points": ["3-5 angles for outreach"],
      "ipp_breakdown": [
        { "label": "Industry fit", "verdict": "strong|partial|weak|unknown", "note": "..." },
        { "label": "Company size fit", "verdict": "strong|partial|weak|unknown", "note": "..." },
        { "label": "Role relevance", "verdict": "strong|partial|weak|unknown", "note": "..." },
        { "label": "Pain point alignment", "verdict": "strong|partial|weak|unknown", "note": "..." },
        { "label": "Tech / buying signal", "verdict": "strong|partial|weak|unknown", "note": "..." }
      ],
      "emails": [
        { "step": 1, "subject": "under 60 chars", "body": "~${wordCount} words, plain text, no signature", "cta": "the CTA used", "send_after_days": 0 }
      ]
    }
  ]
}
Make sure there are exactly ${leads.length} results, one per lead. Use the leadSuffix to match each lead.`;

    // 4. ONE AI call for all leads
    const content = await chatCompletion({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 16000,
      response_format: { type: "json_object" },
    });

    let parsed: { results: any[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid batch JSON");
    }

    if (!Array.isArray(parsed.results)) {
      throw new Error("AI response missing results array");
    }

    // 5. Resolve unsubscribe footer (best-effort)
    let unsubFooter = "";
    try {
      const sb = supabase as any;
      const { data: f } = await sb
        .from("lists")
        .select("unsubscribe_footer_enabled, unsubscribe_footer_text")
        .eq("id", data.listId)
        .maybeSingle();
      if (f && f.unsubscribe_footer_enabled !== false) {
        unsubFooter =
          (f.unsubscribe_footer_text && String(f.unsubscribe_footer_text).trim()) ||
          DEFAULT_UNSUB_FOOTER;
      }
    } catch {
      /* skip */
    }

    // 6. Build a lookup map: leadSuffix → lead.id
    const leadBySuffix = new Map<string, string>();
    for (const lead of leads) {
      leadBySuffix.set(lead.id.slice(-6), lead.id);
    }

    // 7. Process results, bulk update + charge
    const results: BatchEnrichRow[] = [];
    let successCount = 0;
    const updates: Promise<any>[] = [];

    for (const r of parsed.results) {
      const leadId = leadBySuffix.get(String(r.leadSuffix ?? ""));
      if (!leadId) {
        results.push({ leadId: r.leadSuffix ?? "unknown", score: 0, reasoning: "No matching lead", pain_points: [], talking_points: [], emails: [], error: "Unmatched" });
        continue;
      }

      const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
      const emails = (Array.isArray(r.emails) ? r.emails : []).slice(0, numEmails).map((e: any, i: number) => ({
        step: i + 1,
        subject: String(e.subject ?? "").slice(0, 200),
        body: unsubFooter ? `${String(e.body ?? "")}\n\n${unsubFooter}` : String(e.body ?? ""),
        cta: String(e.cta ?? ""),
        send_after_days: Number.isFinite(Number(e.send_after_days)) ? Number(e.send_after_days) : i * 3,
      }));

      results.push({
        leadId,
        score,
        reasoning: String(r.reasoning ?? ""),
        pain_points: Array.isArray(r.pain_points) ? r.pain_points : [],
        talking_points: Array.isArray(r.talking_points) ? r.talking_points : [],
        ipp_breakdown: Array.isArray(r.ipp_breakdown) ? r.ipp_breakdown.filter((s: any) => s && typeof s === "object").map((s: any) => ({
          label: String(s.label ?? "").slice(0, 60),
          verdict: (["strong", "partial", "weak", "unknown"].includes(s.verdict) ? s.verdict : "unknown") as IppSignal["verdict"],
          note: String(s.note ?? "").slice(0, 300),
        })).slice(0, 8) : [],
        emails,
      });

      // Bulk update per lead
      updates.push(
        supabase
          .from("list_leads")
          .update({
            score,
            research: {
              reasoning: String(r.reasoning ?? ""),
              pain_points: Array.isArray(r.pain_points) ? r.pain_points : [],
              talking_points: Array.isArray(r.talking_points) ? r.talking_points : [],
              ipp_breakdown: results[results.length - 1].ipp_breakdown,
            },
            emails,
            email_subject: emails[0]?.subject ?? "",
            email_body: emails[0]?.body ?? "",
            status: "enriched",
          })
          .eq("list_id", data.listId)
          .eq("lead_id", leadId),
      );
      successCount++;
    }

    // Wait for all updates
    if (updates.length > 0) {
      const settled = await Promise.allSettled(updates);
      const failed = settled.filter((s) => s.status === "rejected");
      if (failed.length > 0) {
        console.error(`${failed.length} batch updates failed`);
      }
    }

    // Charge credits for successful enrichments
    if (successCount > 0) {
      const { chargeUser } = await import("@/lib/credits.server");
      await chargeUser(userId, "enrich", successCount, `batch:${data.listId}`);
    }

    return {
      ok: true as const,
      totalLeads: leads.length,
      enriched: successCount,
      results,
    };
  });

// ── Single-lead enrichment (original, used as fallback) ──

export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: list, error: listErr } = await supabase
      .from("lists")
      .select(
        "id, name, description, sender_name, sender_title, sender_company, what_selling, key_selling_points, num_emails, word_count, personalization_level, cta_type, extra_instructions",
      )
      .eq("id", data.listId)
      .maybeSingle();
    if (listErr) throw new Error(listErr.message);
    if (!list) throw new Error("List not found");

    if (!list.what_selling || !list.sender_name) {
      throw new Error("Set up the campaign first (sender + what you're selling).");
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select(
        "id,first_name,last_name,title,linkedin_url,city,state,country,org_name,org_description,org_industry,org_employee_count,org_technologies_used,org_website_url,email",
      )
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!lead) throw new Error("Lead not found");

    const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "the prospect";
    const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ") || "unknown";
    const numEmails = Math.max(1, Math.min(10, list.num_emails ?? 4));
    const wordCount = Math.max(40, Math.min(400, list.word_count ?? 150));

    const personalizationGuide: Record<string, string> = {
      low: "Light personalization — mainly use first name and company name.",
      medium: "Medium personalization — reference their role and industry, but keep it efficient.",
      high: "High, hand-written feel — reference 1-2 specific details from their profile or company. Should feel researched, not templated.",
    };

    const ctaGuide: Record<string, string> = {
      auto: "Pick the best CTA per email — vary across the sequence (soft ask, calendar link, quick reply, breakup, etc.).",
      meeting: "Always ask for a 15-min meeting.",
      reply: "Always ask for a simple reply (e.g. 'worth a quick chat?').",
      resource: "Always offer a resource (case study, one-pager, demo video).",
      question: "Always end with a single open-ended question.",
    };

    const system = `You are an elite B2B sales copywriter. You research a prospect, score fit, and write a multi-email cold sequence that does NOT sound templated. Every email is conversational, plain text, no signature placeholder. Single clear CTA per email. Vary the angle across the sequence — do not repeat the same pitch.`;

    const userPrompt = `CAMPAIGN
Name: ${list.name}
Description: ${list.description ?? "(none)"}
What's being sold: ${list.what_selling}
Key selling points / ICP notes: ${list.key_selling_points ?? "(none)"}
Sender: ${list.sender_name}${list.sender_title ? ", " + list.sender_title : ""}${list.sender_company ? " @ " + list.sender_company : ""}
Sequence length: ${numEmails} emails
Target word count per email: ~${wordCount} words
Personalization: ${personalizationGuide[list.personalization_level] ?? personalizationGuide.high}
CTA strategy: ${ctaGuide[list.cta_type] ?? ctaGuide.auto}
Extra instructions: ${list.extra_instructions ?? "(none)"}

PROSPECT
Name: ${fullName}
Title: ${lead.title ?? "—"}
Location: ${location}
LinkedIn: ${lead.linkedin_url ?? "—"}

COMPANY
Name: ${lead.org_name ?? "—"}
Industry: ${lead.org_industry ?? "—"}
Headcount: ${lead.org_employee_count ?? "—"}
Website: ${lead.org_website_url ?? "—"}
Technologies: ${lead.org_technologies_used ?? "—"}
Description: ${lead.org_description ?? "—"}

Return JSON with this exact shape:
{
  "score": number 0-100 (fit for what's being sold),
  "reasoning": "1-2 sentence explanation",
  "pain_points": ["3-5 inferred pain points relevant to what's being sold"],
  "talking_points": ["3-5 angles for outreach"],
  "ipp_breakdown": [
    { "label": "Industry fit", "verdict": "strong|partial|weak|unknown", "note": "1 short sentence citing evidence" },
    { "label": "Company size fit", "verdict": "strong|partial|weak|unknown", "note": "..." },
    { "label": "Role relevance", "verdict": "strong|partial|weak|unknown", "note": "..." },
    { "label": "Pain point alignment", "verdict": "strong|partial|weak|unknown", "note": "..." },
    { "label": "Tech / buying signal", "verdict": "strong|partial|weak|unknown", "note": "..." }
  ],
  "emails": [
    {
      "step": 1,
      "subject": "subject under 60 chars, lowercase often outperforms",
      "body": "~${wordCount} word email body, plain text, no signature",
      "cta": "1 sentence describing the CTA used",
      "send_after_days": 0
    }
    // ... exactly ${numEmails} emails, step 1..${numEmails}, send_after_days increases (e.g. 0, 3, 4, 5, 7)
      ]
    }`;

    const content = await chatCompletion({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    let parsed: EnrichOutput;
    try {
      parsed = JSON.parse(content) as EnrichOutput;
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));

    // Resolve the campaign's unsubscribe footer (best-effort — columns may not exist yet).
    let unsubFooter = "";
    try {
      const sb = supabase as any;
      const { data: f } = await sb
        .from("lists")
        .select("unsubscribe_footer_enabled, unsubscribe_footer_text")
        .eq("id", data.listId)
        .maybeSingle();
      if (f && f.unsubscribe_footer_enabled !== false) {
        unsubFooter =
          (f.unsubscribe_footer_text && String(f.unsubscribe_footer_text).trim()) ||
          DEFAULT_UNSUB_FOOTER;
      }
    } catch {
      /* footer columns not present yet — skip */
    }

    const emails = (parsed.emails ?? []).slice(0, numEmails).map((e, i) => {
      const rawBody = String(e.body ?? "");
      return {
        step: i + 1,
        subject: String(e.subject ?? "").slice(0, 200),
        body: unsubFooter ? `${rawBody}\n\n${unsubFooter}` : rawBody,
        cta: String(e.cta ?? ""),
        send_after_days: Number.isFinite(Number(e.send_after_days))
          ? Number(e.send_after_days)
          : i * 3,
      };
    });

    const { error: updErr } = await supabase
      .from("list_leads")
      .update({
        score,
        research: {
          reasoning: parsed.reasoning ?? "",
          pain_points: parsed.pain_points ?? [],
          talking_points: parsed.talking_points ?? [],
          ipp_breakdown: Array.isArray(parsed.ipp_breakdown)
            ? parsed.ipp_breakdown
                .filter((s) => s && typeof s === "object")
                .map((s) => ({
                  label: String(s.label ?? "").slice(0, 60),
                  verdict: (["strong", "partial", "weak", "unknown"].includes(s.verdict as string)
                    ? s.verdict
                    : "unknown") as IppSignal["verdict"],
                  note: String(s.note ?? "").slice(0, 300),
                }))
                .slice(0, 8)
            : [],
        },
        emails,
        email_subject: emails[0]?.subject ?? "",
        email_body: emails[0]?.body ?? "",
        status: "enriched",
      })
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId);
    if (updErr) throw new Error(updErr.message);

    // Charge only after the enrichment fully succeeded — never bill for a missing
    // list/lead, an unconfigured campaign, or an AI failure. Admin bypass automatic.
    const { chargeUser } = await import("@/lib/credits.server");
    await chargeUser(userId, "enrich", 1, `lead:${data.leadId}`);

    return { ok: true as const, score, emailCount: emails.length };
  });
