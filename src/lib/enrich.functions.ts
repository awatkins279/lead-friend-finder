import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
});

type EnrichOutput = {
  score: number;
  reasoning: string;
  pain_points: string[];
  talking_points: string[];
  email_subject: string;
  email_body: string;
};

export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Verify the user owns the list
    const { data: list, error: listErr } = await supabase
      .from("lists")
      .select("id, name, description")
      .eq("id", data.listId)
      .maybeSingle();
    if (listErr) throw new Error(listErr.message);
    if (!list) throw new Error("List not found");

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

    const system = `You are a B2B sales research analyst. Given a prospect and the campaign context, you (1) research and infer likely pain points and buying signals, (2) score fit from 0-100, and (3) draft a personalized cold email that does NOT sound templated. Keep the email under 120 words, conversational, with a clear single CTA. Reference 1-2 specific details from their profile/company so it feels researched.`;

    const userPrompt = `CAMPAIGN / LIST CONTEXT
List name: ${list.name}
List description: ${list.description ?? "(none provided)"}

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

Return a JSON object with this exact shape:
{
  "score": number 0-100,
  "reasoning": "1-2 sentence explanation of the score and fit",
  "pain_points": ["3-5 inferred pain points"],
  "talking_points": ["3-5 angles for outreach"],
  "email_subject": "compelling subject line under 60 chars",
  "email_body": "personalized cold email under 120 words, plain text, no signature placeholder"
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

    const { error: updErr } = await supabase
      .from("list_leads")
      .update({
        score,
        research: {
          reasoning: parsed.reasoning ?? "",
          pain_points: parsed.pain_points ?? [],
          talking_points: parsed.talking_points ?? [],
        },
        email_subject: parsed.email_subject ?? "",
        email_body: parsed.email_body ?? "",
        status: "enriched",
      })
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, score };
  });
