import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatCompletion } from "@/lib/ai-client";

// ============ Call Scorecard ============

const scoreCallInput = z.object({
  callId: z.string().uuid(),
});

export type CallScorecard = {
  overall_score: number;
  opener_rating: number;
  discovery_rating: number;
  objection_handling: number;
  closing_rating: number;
  talk_listen_ratio: string;
  strengths: string[];
  improvements: string[];
  summary: string;
};

const PRACTICE_PERSONAS: Record<string, string> = {
  skeptical:
    "You are a skeptical VP of Sales at a mid-size company. You've been burned by sales tools before. You're busy but polite. Ask tough questions. Don't say yes easily.",
  friendly:
    "You are a friendly but busy marketing director. You're open to new ideas but need convincing on ROI. You ask about pricing and competitors.",
  gatekeeper:
    "You are an executive assistant screening calls. You're polite but protective of your boss's time. You need a compelling reason to pass the rep through.",
  angry:
    "You are a stressed operations manager having a bad day. You're short with the rep initially. If they stay calm and provide value, you soften up.",
};

export const generateCallScorecard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scoreCallInput.parse(i))
  .handler(async ({ data, context }): Promise<CallScorecard> => {
    const { supabase, userId } = context;

    const { data: call } = await supabase
      .from("calls")
      .select("*, leads(first_name,last_name,title,org_name,org_industry)")
      .eq("id", data.callId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!call) throw new Error("Call not found");

    const lead = (call as any).leads;
    const prospect = lead
      ? `${lead.first_name || ""} ${lead.last_name || ""} — ${lead.title || ""} at ${lead.org_name || ""}`
      : "unknown prospect";

    const callInfo = [
      `Prospect: ${prospect}`,
      `Duration: ${(call as any).duration_sec || "unknown"} seconds`,
      `Outcome: ${(call as any).outcome || "not recorded"}`,
      `Notes: ${(call as any).notes || "none"}`,
      `Status: ${(call as any).status}`,
    ].join("\n");

    const content = await chatCompletion({
      model: "deepseek/deepseek-chat",
      messages: [
        {
          role: "system",
          content: `You are a world-class cold calling coach. Score sales calls objectively. Focus on:
- Opener effectiveness (pattern interrupt, permission-based)
- Discovery quality (NEPQ-style questions, pain surfacing)
- Objection handling (reframing, not arguing)
- Closing strength (commitment ask, next steps)
- Talk/listen ratio (should be ~30/70 rep/prospect)

Output ONLY valid JSON. No markdown. No commentary.`,
        },
        {
          role: "user",
          content: `Score this cold call:\n\n${callInfo}\n\nReturn JSON:
{
  "overall_score": 0-100,
  "opener_rating": 0-10,
  "discovery_rating": 0-10,
  "objection_handling": 0-10,
  "closing_rating": 0-10,
  "talk_listen_ratio": "e.g. 40/60 rep-led",
  "strengths": ["2-3 things done well"],
  "improvements": ["2-3 specific improvements"],
  "summary": "1-2 sentence overall assessment"
}`,
        },
      ],
      max_tokens: 600,
    });

    const parsed = JSON.parse(content) as CallScorecard;
    parsed.overall_score = Math.max(0, Math.min(100, Math.round(parsed.overall_score || 50)));

    // Save scorecard to the call
    await supabase
      .from("calls")
      .update({
        scorecard: parsed as any,
        call_score: parsed.overall_score,
      })
      .eq("id", data.callId)
      .eq("user_id", userId);

    return parsed;
  });

// ============ AI Practice Bot ============

const practiceInput = z.object({
  sessionId: z.string().uuid().optional(),
  title: z.string().max(100).optional(),
  scenario: z.enum(["skeptical", "friendly", "gatekeeper", "angry"]),
  productContext: z.string().max(3000).optional(),
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["rep", "prospect"]),
        text: z.string(),
      }),
    )
    .optional(),
});

type PracticeResponse = {
  sessionId: string;
  prospectReply: string;
  intent: string;
  coachingTip: string | null;
  isEnding: boolean;
  scorecard: CallScorecard | null;
};

export const practiceColdCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => practiceInput.parse(i))
  .handler(async ({ data, context }): Promise<PracticeResponse> => {
    const { supabase, userId } = context;

    // Get or create session
    let sessionId = data.sessionId;
    if (!sessionId) {
      const { data: sess } = await supabase
        .from("call_practice_sessions")
        .insert({
          user_id: userId,
          title: data.title || "Practice Session",
          scenario: data.scenario,
          product_context: data.productContext,
          prospect_persona: PRACTICE_PERSONAS[data.scenario],
          transcript: [],
        })
        .select("id")
        .single();
      if (!sess) throw new Error("Failed to create session");
      sessionId = sess.id;
    }

    // Load existing transcript
    const { data: session } = await supabase
      .from("call_practice_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();
    if (!session) throw new Error("Session not found");

    const history = (session.transcript || []) as Array<{ role: string; text: string }>;
    history.push({ role: "rep", text: data.message });

    // Check if the rep wants to end
    const isEnding = /bye|goodbye|end call|hang up|thanks for your time/i.test(data.message);

    const persona = PRACTICE_PERSONAS[data.scenario] || PRACTICE_PERSONAS.skeptical;
    const productInfo = data.productContext
      ? `\nWHAT THE REP IS SELLING:\n${data.productContext}`
      : "";

    const thread = history
      .slice(-10)
      .map((t) => `${t.role === "rep" ? "REP" : "PROSPECT"}: ${t.text}`)
      .join("\n");

    const content = await chatCompletion({
      model: "deepseek/deepseek-chat",
      messages: [
        {
          role: "system",
          content: `${persona}${productInfo}\n\nYou are a PROSPECT in a cold call practice session. Respond naturally as a real person would. Be skeptical, ask questions, throw objections — but stay realistic. Keep responses under 3 sentences. If the rep is clearly trying to end the call, wrap it up gracefully.`,
        },
        {
          role: "user",
          content: `CONVERSATION:\n${thread}\n\n${isEnding ? "The rep seems to be ending the call. Wrap up naturally." : "Reply as the prospect."}\n\nReturn JSON:\n{\n  "prospect_reply": "what you say as the prospect",\n  "intent": "objection|question|curious|ready_to_end|interested",\n  "coaching_tip": "one quick tip for the rep, or null"\n}`,
        },
      ],
      max_tokens: 400,
    });

    const parsed = JSON.parse(content);
    const prospectReply = parsed.prospect_reply || "I see. Well, thanks for the call.";

    history.push({ role: "prospect", text: prospectReply });

    // Save transcript
    await supabase
      .from("call_practice_sessions")
      .update({
        transcript: history as any,
        completed_at: isEnding ? new Date().toISOString() : null,
      })
      .eq("id", sessionId);

    // Generate scorecard if ending
    let scorecard: CallScorecard | null = null;
    if (isEnding) {
      try {
        const scoreContent = await chatCompletion({
          model: "deepseek/deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                "Score this practice cold call. Focus on NEPQ techniques, objection handling, and tone. Output ONLY valid JSON.",
            },
            {
              role: "user",
              content: `CONVERSATION:\n${history.map((t: any) => `${t.role.toUpperCase()}: ${t.text}`).join("\n")}\n\nReturn JSON:\n{\n  "overall_score": 0-100,\n  "opener_rating": 0-10,\n  "discovery_rating": 0-10,\n  "objection_handling": 0-10,\n  "closing_rating": 0-10,\n  "talk_listen_ratio": "e.g. 60/40",\n  "strengths": ["2-3 things done well"],\n  "improvements": ["2-3 specific improvements"],\n  "summary": "1-2 sentence assessment"\n}`,
            },
          ],
          max_tokens: 500,
        });
        scorecard = JSON.parse(scoreContent) as CallScorecard;
        scorecard.overall_score = Math.max(
          0,
          Math.min(100, Math.round(scorecard.overall_score || 50)),
        );

        await supabase
          .from("call_practice_sessions")
          .update({ score: scorecard.overall_score, scorecard: scorecard as any })
          .eq("id", sessionId);
      } catch {
        // Scorecard is best-effort
      }
    }

    return {
      sessionId,
      prospectReply,
      intent: parsed.intent || "curious",
      coachingTip: parsed.coaching_tip || null,
      isEnding,
      scorecard,
    };
  });
