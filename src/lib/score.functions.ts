import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(25),
  context: z.string().min(10).max(4000),
});

type Signal = {
  label: string;
  verdict: "strong" | "partial" | "weak" | "unknown";
  note: string;
};

type ScoreRow = {
  leadId: string;
  score: number;
  reasoning: string;
  signals: Signal[];
  strengths: string[];
  gaps: string[];
};

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

For every prospect, return a detailed IPP qualification. Return JSON exactly:
{
  "scores": [
    {
      "leadId": "...",
      "score": 0-100,
      "reasoning": "1-2 sentence overall verdict",
      "signals": [
        { "label": "Industry fit", "verdict": "strong|partial|weak|unknown", "note": "1 short sentence with evidence" },
        { "label": "Company size fit", "verdict": "...", "note": "..." },
        { "label": "Role relevance", "verdict": "...", "note": "..." },
        { "label": "Pain point alignment", "verdict": "...", "note": "..." },
        { "label": "Tech / buying signal", "verdict": "...", "note": "..." },
        { "label": "Geography / timing", "verdict": "...", "note": "..." }
      ],
      "strengths": ["2-3 concrete reasons this prospect IS a fit"],
      "gaps": ["1-3 concrete reasons they may NOT be a fit, or 'none' if perfect"]
    }
  ]
}
Use only "strong" / "partial" / "weak" / "unknown" for verdicts. Cite evidence from the prospect's title, industry, headcount, tech, or description. Do not inflate.

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
        max_tokens: 8000,
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
      parsed = extractJson(content) as { scores?: ScoreRow[] };
    } catch (e) {
      console.error("Score JSON parse failed. Raw content:", content.slice(0, 1000));
      throw new Error("AI returned invalid JSON — try scoring fewer leads at once.");
    }


    const allowed: Signal["verdict"][] = ["strong", "partial", "weak", "unknown"];
    const scores: ScoreRow[] = (parsed.scores ?? [])
      .map((s: any) => ({
        leadId: String(s.leadId),
        score: Math.max(0, Math.min(100, Math.round(Number(s.score) || 0))),
        reasoning: String(s.reasoning ?? "").slice(0, 400),
        signals: Array.isArray(s.signals)
          ? s.signals
              .filter((x: any) => x && typeof x === "object")
              .map((x: any) => ({
                label: String(x.label ?? "").slice(0, 60),
                verdict: (allowed.includes(x.verdict) ? x.verdict : "unknown") as Signal["verdict"],
                note: String(x.note ?? "").slice(0, 240),
              }))
              .slice(0, 8)
          : [],
        strengths: Array.isArray(s.strengths)
          ? s.strengths.map((v: any) => String(v).slice(0, 200)).slice(0, 5)
          : [],
        gaps: Array.isArray(s.gaps)
          ? s.gaps.map((v: any) => String(v).slice(0, 200)).slice(0, 5)
          : [],
      }))
      .filter((s) => data.leadIds.includes(s.leadId));

    return { scores };
  });

// Tolerant JSON extractor — strips markdown fences, finds object bounds,
// repairs trailing commas / control chars, and attempts to close a truncated
// "scores" array so a partial response still yields usable rows.
function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  s = s.slice(start);

  const tryParse = (txt: string) => JSON.parse(txt);

  try { return tryParse(s); } catch {}

  // Clean trailing commas + stray control chars
  let cleaned = s
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  try { return tryParse(cleaned); } catch {}

  // Truncation repair: cut after the last complete object inside scores[]
  const arrStart = cleaned.indexOf('"scores"');
  if (arrStart !== -1) {
    const bracketStart = cleaned.indexOf("[", arrStart);
    if (bracketStart !== -1) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let lastGoodEnd = -1;
      for (let i = bracketStart; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) lastGoodEnd = i;
        }
      }
      if (lastGoodEnd !== -1) {
        const repaired = cleaned.slice(0, lastGoodEnd + 1) + "]}";
        return tryParse(repaired);
      }
    }
  }
  throw new Error("Unrecoverable JSON");
}
