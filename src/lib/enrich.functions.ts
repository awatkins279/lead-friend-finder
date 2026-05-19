import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
});

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

export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

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

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit exceeded. Try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace settings.");
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const payload = await res.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "{}";

    let parsed: EnrichOutput;
    try {
      parsed = JSON.parse(content) as EnrichOutput;
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const emails = (parsed.emails ?? []).slice(0, numEmails).map((e, i) => ({
      step: i + 1,
      subject: String(e.subject ?? "").slice(0, 200),
      body: String(e.body ?? ""),
      cta: String(e.cta ?? ""),
      send_after_days: Number.isFinite(Number(e.send_after_days)) ? Number(e.send_after_days) : i * 3,
    }));

    const { error: updErr } = await supabase
      .from("list_leads")
      .update({
        score,
        research: {
          reasoning: parsed.reasoning ?? "",
          pain_points: parsed.pain_points ?? [],
          talking_points: parsed.talking_points ?? [],
        },
        emails,
        email_subject: emails[0]?.subject ?? "",
        email_body: emails[0]?.body ?? "",
        status: "enriched",
      })
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, score, emailCount: emails.length };
  });
