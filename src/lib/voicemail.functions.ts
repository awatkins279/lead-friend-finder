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
      // Strip filler words / disfluencies the model might have slipped in.
      // Matches "um", "uh", "umm", "uhh", "uhm", "er", "erm", "ah", "ahh",
      // "hmm" — case-insensitive, with optional trailing punctuation.
      s = s.replace(/\b(u+m+h?|u+h+m*|e+r+m*|a+h+|h+m+)\b[,.\s]*/gi, "");
      // Collapse leftover double spaces / orphan punctuation
      s = s.replace(/\s+([,.!?])/g, "$1");
      s = s.replace(/\s{2,}/g, " ").trim();
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
              speed: 0.82,
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
