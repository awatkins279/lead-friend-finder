import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type VoicemailSettings = {
  rep_name?: string;
  what_selling?: string;
  length?: "short" | "medium" | "long";
  tone?: "conversational" | "professional" | "direct";
  cta_type?: "callback" | "text_back" | "book_meeting" | "custom";
  cta_custom?: string;
  personalization?: number; // 0..100
  extra_instructions?: string;
};

const settingsSchema = z.object({
  rep_name: z.string().max(120).optional(),
  what_selling: z.string().max(4000).optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  tone: z.enum(["conversational", "professional", "direct"]).optional(),
  cta_type: z.enum(["callback", "text_back", "book_meeting", "custom"]).optional(),
  cta_custom: z.string().max(400).optional(),
  personalization: z.number().min(0).max(100).optional(),
  extra_instructions: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Get profile (voice id + settings)
// ---------------------------------------------------------------------------
export const getVoicemailProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("elevenlabs_voice_id, voicemail_settings")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      voiceId: (data as any)?.elevenlabs_voice_id ?? null,
      settings: ((data as any)?.voicemail_settings ?? {}) as VoicemailSettings,
    };
  });

// ---------------------------------------------------------------------------
// Save settings
// ---------------------------------------------------------------------------
export const saveVoicemailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => settingsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Upsert so missing profile rows don't fail
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, voicemail_settings: data as any } as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Clone voice from uploaded sample (in voice-clone-samples bucket)
// ---------------------------------------------------------------------------
export const cloneVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ storagePath: z.string().min(1), name: z.string().min(1).max(120) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ voiceId: string }> => {
    const { supabase, userId } = context;
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    // Download the audio sample
    const { data: blob, error: dlErr } = await supabase.storage
      .from("voice-clone-samples")
      .download(data.storagePath);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Failed to read audio sample");

    const form = new FormData();
    form.append("name", data.name);
    form.append("description", "Cold-calling voicemail clone");
    // ElevenLabs expects field name "files"
    form.append("files", blob, "sample.webm");

    const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Voice clone failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const payload = await res.json();
    const voiceId: string | undefined = payload?.voice_id;
    if (!voiceId) throw new Error("ElevenLabs did not return a voice_id");

    const { error: upErr } = await supabase
      .from("profiles")
      .upsert({ id: userId, elevenlabs_voice_id: voiceId } as any, { onConflict: "id" });
    if (upErr) throw new Error(upErr.message);

    return { voiceId };
  });

// ---------------------------------------------------------------------------
// Generate a personalized voicemail script via Lovable AI
// ---------------------------------------------------------------------------
const lengthGuide: Record<NonNullable<VoicemailSettings["length"]>, string> = {
  short: "15-20 seconds (~45-60 words)",
  medium: "25-30 seconds (~70-85 words)",
  long: "35-45 seconds (~95-120 words)",
};

const ctaGuide: Record<NonNullable<VoicemailSettings["cta_type"]>, string> = {
  callback: "Ask them to call you back at a convenient time.",
  text_back: "Ask them to shoot you a quick text.",
  book_meeting: "Ask them to grab a slot on your calendar.",
  custom: "Use the custom CTA the rep provided verbatim or paraphrased.",
};

export const generateVoicemailScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ listId: z.string().uuid(), leadId: z.string().min(1) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ script: string }> => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const [{ data: profile }, { data: lead }, { data: listLead }] = await Promise.all([
      supabase
        .from("profiles")
        .select("voicemail_settings, full_name")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("leads")
        .select("first_name,last_name,title,org_name,org_industry,org_description,city,state,country")
        .eq("id", data.leadId)
        .maybeSingle(),
      supabase
        .from("list_leads")
        .select("research, score")
        .eq("list_id", data.listId)
        .eq("lead_id", data.leadId)
        .maybeSingle(),
    ]);

    const settings = (((profile as any)?.voicemail_settings ?? {}) as VoicemailSettings);
    const repName = settings.rep_name?.trim() || (profile as any)?.full_name || "the rep";
    const length = settings.length ?? "medium";
    const tone = settings.tone ?? "conversational";
    const cta = settings.cta_type ?? "callback";

    const ctaText =
      cta === "custom" && settings.cta_custom?.trim()
        ? settings.cta_custom.trim()
        : ctaGuide[cta];

    const prospect = lead
      ? {
          name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "there",
          first: lead.first_name ?? "there",
          title: lead.title ?? "",
          company: lead.org_name ?? "",
          industry: lead.org_industry ?? "",
          location: [lead.city, lead.state, lead.country].filter(Boolean).join(", "),
          about: (lead.org_description ?? "").slice(0, 400),
        }
      : null;

    const research = (listLead as any)?.research
      ? JSON.stringify((listLead as any).research).slice(0, 800)
      : "";

    const userPrompt = `Write a personalized cold-call voicemail script. Output ONLY the words the rep will say — no stage directions, no labels, no quotes, no preamble.

REP:
- Name: ${repName}
- Selling: ${settings.what_selling || "(not specified)"}

PROSPECT:
${prospect ? `- Name: ${prospect.name} (call them ${prospect.first})
- Title: ${prospect.title}
- Company: ${prospect.company}
- Industry: ${prospect.industry}
- Location: ${prospect.location}
- About company: ${prospect.about}` : "- (no prospect info)"}
${research ? `- Research notes: ${research}` : ""}

CONSTRAINTS:
- Length: ${lengthGuide[length]}
- Tone: ${tone}
- CTA: ${ctaText}
- Personalization level: ${settings.personalization ?? 60}/100 — higher = reference something specific naturally
${settings.extra_instructions ? `- Extra rep instructions: ${settings.extra_instructions}` : ""}

RULES (CRITICAL):
- Sound like a real human left this voicemail. Conversational, relaxed, never templated.
- ABSOLUTELY NO filler words. Do NOT write "um", "uh", "umm", "uhh", "ah", "ahh", "er", "erm", "hmm", "like" (as a filler), "you know", "I mean". Clean, deliberate speech only.
- NEVER state the obvious about what their company does ("I see you guys do X").
- Reference something specific to them naturally — like you actually did your homework, without narrating it.
- Use the rep's first name and the prospect's first name.
- No "I hope this finds you well", no "I wanted to reach out", no corporate jargon.
- One short pause-friendly message. End with the CTA.
- Output ONLY the voicemail words. Nothing else. No labels. No quotes. No formatting.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You write natural, human-sounding sales voicemails. Output is plain text the rep speaks aloud. No labels, no formatting, no quotes.",
          },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 600,
      }),
    });

    if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in Workspace settings");
    if (!res.ok) throw new Error(`AI error ${res.status}`);

    const payload = await res.json();
    let script: string = payload.choices?.[0]?.message?.content ?? "";
    script = script.trim().replace(/^["']|["']$/g, "").trim();
    if (!script) throw new Error("AI returned empty script");

    return { script };
  });

// ---------------------------------------------------------------------------
// Synthesize voicemail audio via ElevenLabs TTS. Returns base64 MP3.
// One silent retry on transient failure.
// ---------------------------------------------------------------------------
export const synthesizeVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ script: z.string().min(1).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ audioBase64: string; voiceId: string }> => {
    const { supabase, userId } = context;
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const { data: profile } = await supabase
      .from("profiles")
      .select("elevenlabs_voice_id")
      .eq("id", userId)
      .maybeSingle();
    const voiceId = (profile as any)?.elevenlabs_voice_id as string | null;
    if (!voiceId) throw new Error("No voice clone — record a sample first");

    // Belfort-style tonality pass: slow it down, force the model to actually
    // honor punctuation. We lengthen pauses by upgrading punctuation marks
    // (commas -> ellipses, periods -> double-stops) and inject breath beats
    // between sentences. ElevenLabs respects "..." and " — " as real pauses.
    const shapeForTonality = (raw: string): string => {
      let s = raw.trim();
      // Normalize whitespace
      s = s.replace(/\s+/g, " ");
      // Promote em-dashes / hyphenated asides into real breath pauses
      s = s.replace(/\s*[—–-]\s*/g, " — ");
      // Comma -> short pause
      s = s.replace(/,\s+/g, "... ");
      // Sentence-end punctuation -> longer pause + slight reset
      s = s.replace(/([.!?])\s+(?=[A-Z0-9"'])/g, "$1.. ");
      // Trim repeats
      s = s.replace(/\.{4,}/g, "...");
      return s.trim();
    };

    const shapedScript = shapeForTonality(data.script);

    const callTts = async (): Promise<ArrayBuffer> => {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: shapedScript,
            // multilingual_v2 honors prosody / punctuation far better than turbo
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              // Lower stability = more dynamic range, emotional inflection
              stability: 0.32,
              similarity_boost: 0.85,
              // Higher style = more expressive, Belfort-style swagger
              style: 0.65,
              use_speaker_boost: true,
              // Slow it down — confident closers don't rush
              speed: 0.92,
            },
          }),
        },
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`ElevenLabs TTS failed (${res.status}): ${t.slice(0, 200)}`);
      }
      return res.arrayBuffer();
    };

    let buf: ArrayBuffer;
    try {
      buf = await callTts();
    } catch {
      // one silent retry
      buf = await callTts();
    }

    const audioBase64 = Buffer.from(buf).toString("base64");
    return { audioBase64, voiceId };
  });

// ---------------------------------------------------------------------------
// Log a voicemail drop attempt
// ---------------------------------------------------------------------------
export const logVoicemailDrop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        listId: z.string().uuid(),
        leadId: z.string().min(1),
        callId: z.string().uuid().nullable().optional(),
        script: z.string().min(1).max(4000),
        voiceId: z.string().nullable().optional(),
        audioSeconds: z.number().min(0).max(600).optional(),
        status: z.enum(["sent", "failed"]),
        error: z.string().max(500).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("voicemail_logs").insert({
      user_id: userId,
      list_id: data.listId,
      lead_id: data.leadId,
      call_id: data.callId ?? null,
      script: data.script,
      voice_id: data.voiceId ?? null,
      audio_seconds: data.audioSeconds ?? null,
      status: data.status,
      error: data.error ?? null,
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
