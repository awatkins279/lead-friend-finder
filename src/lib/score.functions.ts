import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(50),
  context: z.string().min(10).max(4000),
});

type ScoreRow = { leadId: string; score: number; reasoning: string };

export const scoreLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ scores: ScoreRow[] }> => {
    const { supabase } = context;

    const { data: leads, error } = await supabase
      .from("leads")
      .select(
        "id,first_name,last_name,title,city,state,country,org_name,org_description,org_industry,org_employee_count,org_technologies_used",
      )
      .in("id", data.leadIds);
    if (error) throw new Error(error.message);
    if (!leads || leads.length === 0) return { scores: [] };

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const compact = leads.map((l) => ({
      id: l.id,
      name: [l.first_name, l.last_name].filter(Boolean).join(" ") || "—",
      title: l.title ?? "",
      location: [l.city, l.state, l.country].filter(Boolean).join(", "),
      company: l.org_name ?? "",
      industry: l.org_industry ?? "",
      headcount: l.org_employee_count ?? "",
      tech: l.org_technologies_used ?? "",
      description: (l.org_description ?? "").slice(0, 400),
    }));

    const system = `You are an elite B2B sales qualification analyst. You score prospects 0-100 on how likely they are to be in-market for the seller's offer right now. Be ruthless and honest: 90+ means "obvious ICP, clear pain, buy now"; 70-89 "strong fit"; 40-69 "plausible but weak signal"; <40 "wrong profile". Use the prospect's title, company industry, size, tech stack, and description as evidence. Do not inflate scores.`;

    const userPrompt = `SELLER CONTEXT (what we're selling / who we want):
${data.context}

Score every prospect below. Return JSON: { "scores": [ { "leadId": "...", "score": 0-100, "reasoning": "1 sentence why" }, ... ] }. One entry per prospect, same ids.

PROSPECTS:
${JSON.stringify(compact)}`;

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
    let parsed: { scores?: ScoreRow[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    const scores: ScoreRow[] = (parsed.scores ?? [])
      .map((s) => ({
        leadId: String(s.leadId),
        score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 0))),
        reasoning: String(s.reasoning ?? "").slice(0, 400),
      }))
      .filter((s) => data.leadIds.includes(s.leadId));

    return { scores };
  });
