import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NEPQ_SYSTEM_PROMPT } from "./nepq-prompt";

// ---------------------------------------------------------------------------
// Generate a personalized NEPQ-style call script for a single lead.
// Cached on list_leads.call_script — re-opening the call page is instant.
// ---------------------------------------------------------------------------
const genInput = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
  force: z.boolean().optional(),
});

export type CallScript = {
  opener: string;
  talk_track: { heading: string; body: string }[];
  problem_questions: string[];
  solution_questions: string[];
  consequence_questions: string[];
  qualifying_questions: string[];
  close: string;
  objection_map: { objection: string; response: string }[];
};

export const generateCallScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => genInput.parse(i))
  .handler(async ({ data, context }): Promise<{ script: CallScript }> => {
    const { supabase } = context;

    // Cached?
    if (!data.force) {
      const { data: existing } = await supabase
        .from("list_leads")
        .select("call_script")
        .eq("list_id", data.listId)
        .eq("lead_id", data.leadId)
        .maybeSingle();
      if (existing?.call_script) {
        return { script: existing.call_script as unknown as CallScript };
      }
    }

    const [{ data: list }, { data: cfg }, { data: lead }] = await Promise.all([
      supabase.from("lists").select("name, what_selling, key_selling_points, sender_name, sender_company").eq("id", data.listId).maybeSingle(),
      supabase.from("list_call_configs").select("*").eq("list_id", data.listId).maybeSingle(),
      supabase.from("leads").select("first_name,last_name,title,org_name,org_industry,org_description,org_employee_count,city,state,country").eq("id", data.leadId).maybeSingle(),
    ]);

    if (!lead) throw new Error("Lead not found");
    if (!list?.what_selling) throw new Error("Set up the campaign config first");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const system = NEPQ_SYSTEM_PROMPT.replace("{{KNOWLEDGE_BASE}}", "");

    const userPrompt = `Write a personalized cold-call script for this single prospect, using the NEPQ approach.

SELLER:
- Rep name: ${list.sender_name ?? "the rep"}
- Company: ${list.sender_company ?? ""}
- Selling: ${list.what_selling}
${list.key_selling_points ? `- ICP / selling points: ${list.key_selling_points}` : ""}

CALLING CONFIG:
- Tone: ${cfg?.tone ?? "consultative"}
- Personalization: ${cfg?.personalization_level ?? "high"}
- Objectives: ${cfg?.objectives ?? "Book a 15-min discovery call"}
- Common objections + preferred handling: ${cfg?.objection_notes ?? "None specified"}
${cfg?.script_template ? `- USER-PROVIDED BASE TEMPLATE (use as the backbone, personalize per the prospect):\n${cfg.script_template}` : ""}
${cfg?.extra_instructions ? `- Extra rep instructions: ${cfg.extra_instructions}` : ""}



PROSPECT:
- Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ")}
- Title: ${lead.title ?? ""}
- Company: ${lead.org_name ?? ""} (${lead.org_industry ?? "?"}, ${lead.org_employee_count ?? "?"} employees)
- Location: ${[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}
- About company: ${(lead.org_description ?? "").slice(0, 400)}

${cfg?.script_template ? `CRITICAL: The user provided a base script template above. Your job is to REWRITE THAT FULL TEMPLATE, line-by-line, personalized for THIS prospect — keep its structure, talking points, stories, statistics, and ordering. Do NOT just extract questions from it. Output the personalized full script in "talk_track" as ordered sections that mirror the template's flow. Then also pull out the NEPQ-style questions into the question arrays so the rep has them isolated for quick reference.` : `No template was provided — generate a full talk-track of your own in "talk_track" with sections like "Pattern interrupt", "Reason for the call", "Pain framing", "Bridge to solution", "Story / proof", etc. Don't just output an opener + questions + close — write the actual things the rep should SAY in between.`}

Return JSON exactly:
{
  "opener": "1-2 sentence pattern-interrupt opener that names them, drops tonality, and asks permission",
  "talk_track": [
    {"heading": "Section name (mirror the template's flow, or use NEPQ phases if no template)", "body": "The actual words the rep says — full sentences, conversational, personalized to THIS prospect. Multiple paragraphs ok. This is the meat of the script."},
    {"heading": "...", "body": "..."}
  ],
  "problem_questions": ["3-5 questions that surface pain in their world — phrased so THEY say the problem"],
  "solution_questions": ["2-3 questions getting them to describe what 'fixed' looks like in their words"],
  "consequence_questions": ["2-3 questions about the cost of doing nothing"],
  "qualifying_questions": ["2-3 questions on budget, decision process, timing — NEPQ-style, not BANT-checklist"],
  "close": "Transition + commitment ask — get THEIR words on the next step",
  "objection_map": [
    {"objection": "Not interested", "response": "NEPQ-style reframe in 1-2 sentences"},
    {"objection": "Send me info", "response": "..."},
    {"objection": "We already have a solution", "response": "..."},
    {"objection": "Too expensive / no budget", "response": "..."},
    {"objection": "Call me back next quarter", "response": "..."}
  ]
}

Every line should feel like it was written for THIS prospect — reference their title, company, or industry naturally. No corporate jargon. No "I wanted to reach out". No "synergy". Conversational, like a peer-to-peer call. The talk_track sections should be SUBSTANTIAL — this is the actual script, not bullet points.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 12000,
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in Workspace settings");
    if (!res.ok) throw new Error(`AI error ${res.status}`);

    const payload = await res.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "{}";

    const tryParseJson = (raw: string): any => {
      let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const start = s.search(/[\{\[]/);
      const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
      if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
      try { return JSON.parse(s); } catch {}
      // Repair: strip control chars, trailing commas
      const repaired = s
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .replace(/,\s*([}\]])/g, "$1");
      try { return JSON.parse(repaired); } catch {}
      // Last resort: progressively trim trailing chars until it parses
      for (let i = repaired.length; i > 100; i -= 50) {
        const candidate = repaired
          .slice(0, i)
          .replace(/,\s*$/, "")
          .replace(/[^\}\]]*$/, "");
        const closed = candidate + "}".repeat(Math.max(0, (candidate.match(/{/g) || []).length - (candidate.match(/}/g) || []).length));
        try { return JSON.parse(closed); } catch {}
      }
      return null;
    };

    const parsed = tryParseJson(content);
    if (!parsed || typeof parsed !== "object") {
      console.error("AI returned unparseable JSON:", content.slice(0, 500));
      throw new Error("AI returned invalid JSON — try again");
    }


    const script: CallScript = {
      opener: String(parsed.opener ?? "").slice(0, 800),
      talk_track: Array.isArray(parsed.talk_track)
        ? parsed.talk_track
            .filter((s: any) => s && typeof s === "object" && (s.heading || s.body))
            .map((s: any) => ({
              heading: String(s.heading ?? "").slice(0, 120),
              body: String(s.body ?? "").slice(0, 2500),
            }))
            .slice(0, 12)
        : [],
      problem_questions: arr(parsed.problem_questions, 8, 400),
      solution_questions: arr(parsed.solution_questions, 6, 400),
      consequence_questions: arr(parsed.consequence_questions, 6, 400),
      qualifying_questions: arr(parsed.qualifying_questions, 6, 400),
      close: String(parsed.close ?? "").slice(0, 800),
      objection_map: Array.isArray(parsed.objection_map)
        ? parsed.objection_map
            .filter((o: any) => o && typeof o === "object")
            .map((o: any) => ({
              objection: String(o.objection ?? "").slice(0, 120),
              response: String(o.response ?? "").slice(0, 600),
            }))
            .slice(0, 10)
        : [],
    };

    // Ensure row exists, then cache the script
    await supabase
      .from("list_leads")
      .upsert(
        { list_id: data.listId, lead_id: data.leadId, call_script: script as any, status: "scripted" },
        { onConflict: "list_id,lead_id" },
      );

    return { script };
  });

function arr(v: unknown, max: number, lim: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).slice(0, lim)).filter(Boolean).slice(0, max);
}

// ---------------------------------------------------------------------------
// Mint a short-lived Twilio Voice Access Token (JWT) for the browser SDK.
// ---------------------------------------------------------------------------
const tokenInput = z.object({
  phoneAccountId: z.string().uuid(),
  identity: z.string().min(1).max(120).optional(),
});

export const getTwilioToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => tokenInput.parse(i))
  .handler(async ({ data, context }): Promise<{ token: string; identity: string }> => {
    const { supabase, userId } = context;

    const { data: acc, error } = await supabase
      .from("user_phone_accounts")
      .select("twilio_account_sid, twilio_api_key_sid, twilio_api_key_secret, twilio_twiml_app_sid")
      .eq("id", data.phoneAccountId)
      .maybeSingle();

    if (error || !acc) throw new Error("Phone account not found");
    if (!acc.twilio_twiml_app_sid || !acc.twilio_account_sid || !acc.twilio_api_key_sid || !acc.twilio_api_key_secret) {
      throw new Error("Twilio account is missing credentials. Edit it in Sending Accounts.");
    }

    const identity = data.identity ?? `rep-${userId.slice(0, 8)}`;

    // Lazy-import on the server only
    const twilio = (await import("twilio")).default;
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(
      acc.twilio_account_sid,
      acc.twilio_api_key_sid,
      acc.twilio_api_key_secret,
      { identity, ttl: 3600 },
    );

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: acc.twilio_twiml_app_sid,
        incomingAllow: false,
      }),
    );

    return { token: token.toJwt(), identity };
  });

// ---------------------------------------------------------------------------
// Create a `calls` row when the rep clicks "Call" — returns callId we pass
// to the Voice SDK as a custom param so the TwiML endpoint can identify it.
// ---------------------------------------------------------------------------
const startInput = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
  phoneAccountId: z.string().uuid(),
  toNumber: z.string().min(3).max(32),
});

export const startCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => startInput.parse(i))
  .handler(async ({ data, context }): Promise<{ callId: string }> => {
    const { supabase, userId } = context;

    const { data: acc } = await supabase
      .from("user_phone_accounts")
      .select("from_number")
      .eq("id", data.phoneAccountId)
      .maybeSingle();
    if (!acc) throw new Error("Phone account not found");

    const { data: row, error } = await supabase
      .from("calls")
      .insert({
        user_id: userId,
        list_id: data.listId,
        lead_id: data.leadId,
        phone_account_id: data.phoneAccountId,
        to_number: data.toNumber,
        from_number: acc.from_number,
        status: "initiated",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { callId: row.id };
  });

// ---------------------------------------------------------------------------
// Persist notes / outcome / final duration after the rep hangs up.
// ---------------------------------------------------------------------------
const endInput = z.object({
  callId: z.string().uuid(),
  durationSec: z.number().int().min(0).max(7200).optional(),
  outcome: z.string().max(40).optional(),
  notes: z.string().max(4000).optional(),
});

export const endCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => endInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("calls")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        duration_sec: data.durationSec ?? null,
        outcome: data.outcome ?? null,
        notes: data.notes ?? null,
      })
      .eq("id", data.callId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// RingCentral RingOut — phones the rep first, bridges to the prospect when answered.
// ---------------------------------------------------------------------------
const ringOutInput = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
  phoneAccountId: z.string().uuid(),
  toNumber: z.string().min(3).max(32),
});

export const startRingOutCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ringOutInput.parse(i))
  .handler(async ({ data, context }): Promise<{ callId: string; ringOutId: string }> => {
    const { supabase, userId } = context;

    const { data: acc, error: accErr } = await supabase
      .from("user_phone_accounts")
      .select("provider, from_number, credentials")
      .eq("id", data.phoneAccountId)
      .maybeSingle();
    if (accErr || !acc) throw new Error("Phone account not found");
    if (acc.provider !== "ringcentral") throw new Error("Account is not RingCentral");

    const creds = (acc.credentials ?? {}) as Record<string, string>;
    const serverUrl = (creds.server_url || "https://platform.ringcentral.com").replace(/\/$/, "");
    const clientId = creds.client_id;
    const clientSecret = creds.client_secret;
    const jwt = creds.jwt;
    const ringTo = creds.ring_to_number;
    const callerId = acc.from_number;

    if (!clientId || !clientSecret || !jwt || !ringTo) {
      throw new Error("RingCentral account is missing credentials. Edit it in Sending Accounts.");
    }

    // 1) Exchange JWT for access token
    const tokenRes = await fetch(`${serverUrl}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`RingCentral auth failed (${tokenRes.status}): ${t.slice(0, 200)}`);
    }
    const tokenJson = await tokenRes.json();
    const accessToken: string = tokenJson.access_token;

    // 2) Place RingOut
    const ringOutRes = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/ring-out`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: { phoneNumber: ringTo },
        to: { phoneNumber: data.toNumber },
        callerId: callerId ? { phoneNumber: callerId } : undefined,
        playPrompt: false,
      }),
    });
    if (!ringOutRes.ok) {
      const t = await ringOutRes.text();
      throw new Error(`RingOut failed (${ringOutRes.status}): ${t.slice(0, 300)}`);
    }
    const ringOutJson = await ringOutRes.json();

    // 3) Persist call row
    const { data: row, error } = await supabase
      .from("calls")
      .insert({
        user_id: userId,
        list_id: data.listId,
        lead_id: data.leadId,
        phone_account_id: data.phoneAccountId,
        to_number: data.toNumber,
        from_number: callerId,
        status: "ringing",
        twilio_call_sid: String(ringOutJson?.id ?? ""),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { callId: row.id, ringOutId: String(ringOutJson?.id ?? "") };
  });
