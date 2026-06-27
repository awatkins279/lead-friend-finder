import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Personalized voicemail templates.
//
// A template is an ordered list of segments:
//   - recorded: a chunk of the rep's real recorded voice (voicemail-drops bucket)
//   - variable: a token (e.g. first_name) spoken per-prospect in the cloned voice
//   - silence:  pacing padding in milliseconds
//
// The ONLY thing AI does is speak the short variable values. The browser stitches
// the final audio (see src/lib/voicemail-audio.ts) — no server-side audio tooling.
// ---------------------------------------------------------------------------

// Variable tokens — same field set used for prospect personalization elsewhere.
export const VOICEMAIL_TOKENS = ["first_name", "last_name", "company", "title"] as const;
export type VoicemailToken = (typeof VOICEMAIL_TOKENS)[number];

const TOKEN_FIELD: Record<VoicemailToken, string> = {
  first_name: "first_name",
  last_name: "last_name",
  company: "org_name",
  title: "title",
};

const segmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recorded"),
    storage_path: z.string().min(1),
    label: z.string().max(80).optional(),
  }),
  z.object({ type: z.literal("variable"), token: z.enum(VOICEMAIL_TOKENS) }),
  z.object({ type: z.literal("silence"), ms: z.number().int().min(0).max(5000) }),
]);
export type VoicemailSegment = z.infer<typeof segmentSchema>;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export const listVoicemailTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await (supabase as any)
      .from("voicemail_templates")
      .select("id, name, segments, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      templates: (data ?? []) as {
        id: string;
        name: string;
        segments: VoicemailSegment[];
        updated_at: string;
      }[],
    };
  });

export const getVoicemailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: tpl, error } = await (supabase as any)
      .from("voicemail_templates")
      .select("id, name, segments")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tpl) throw new Error("Template not found");
    return { template: tpl as { id: string; name: string; segments: VoicemailSegment[] } };
  });

export const upsertVoicemailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        segments: z.array(segmentSchema).max(100),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sb = supabase as any;
    const payload = { user_id: userId, name: data.name, segments: data.segments };
    if (data.id) {
      const { error } = await sb.from("voicemail_templates").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await sb
      .from("voicemail_templates")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

export const deleteVoicemailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("voicemail_templates")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Resolve a template for a specific prospect: returns ordered segments with the
// audio the browser needs (signed URLs). Variable values are synthesized in the
// cloned voice and cached in storage so each (voice, value) is spoken once.
// ---------------------------------------------------------------------------
type ResolvedSegment =
  | { type: "recorded"; url: string }
  | { type: "variable"; token: VoicemailToken; value: string; url: string }
  | { type: "silence"; ms: number };

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function synthVariableClip(
  voiceId: string,
  text: string,
  apiKey: string,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        // Tuned for a short value that blends into a recording: natural, not theatrical.
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.9,
          style: 0.25,
          use_speaker_boost: true,
          speed: 0.95,
        },
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status})${t ? `: ${t.slice(0, 160)}` : ""}`);
  }
  return res.arrayBuffer();
}

export const resolveVoicemailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ templateId: z.string().uuid(), leadId: z.string().min(1) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ voiceId: string; segments: ResolvedSegment[] }> => {
    const { supabase, userId } = context;
    const sb = supabase as any;

    const [{ data: tpl }, { data: lead }, { data: profile }] = await Promise.all([
      sb.from("voicemail_templates").select("segments").eq("id", data.templateId).maybeSingle(),
      supabase
        .from("leads")
        .select("first_name, last_name, org_name, title")
        .eq("id", data.leadId)
        .maybeSingle(),
      supabase.from("profiles").select("elevenlabs_voice_id").eq("id", userId).maybeSingle(),
    ]);
    if (!tpl) throw new Error("Template not found");
    const voiceId = (profile as any)?.elevenlabs_voice_id as string | null;
    if (!voiceId) throw new Error("No voice clone yet — record a voice sample first.");

    const segments = (tpl.segments ?? []) as VoicemailSegment[];
    const leadRow = (lead ?? {}) as Record<string, string | null>;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    const out: ResolvedSegment[] = [];
    for (const seg of segments) {
      if (seg.type === "silence") {
        out.push({ type: "silence", ms: seg.ms });
        continue;
      }
      if (seg.type === "recorded") {
        const { data: signed } = await supabase.storage
          .from("voicemail-drops")
          .createSignedUrl(seg.storage_path, 300);
        if (signed?.signedUrl) out.push({ type: "recorded", url: signed.signedUrl });
        continue;
      }
      // variable
      const value = String(leadRow[TOKEN_FIELD[seg.token]] ?? "").trim();
      if (!value) continue; // graceful fallback: skip missing values (never speak "{{company}}")
      if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

      const folder = `${userId}/${voiceId}`;
      const file = `${await hashText(value.toLowerCase())}.mp3`;
      const path = `${folder}/${file}`;

      // Real cache check — createSignedUrl succeeds even for missing files, so we
      // must list the folder to know whether the clip already exists.
      const { data: listed } = await supabase.storage
        .from("voicemail-variable-clips")
        .list(folder, { search: file, limit: 100 });
      const cached = (listed ?? []).some((f: { name: string }) => f.name === file);

      if (!cached) {
        const buf = await synthVariableClip(voiceId, value, apiKey);
        const { error: upErr } = await supabase.storage
          .from("voicemail-variable-clips")
          .upload(path, new Blob([buf], { type: "audio/mpeg" }), {
            upsert: true,
            contentType: "audio/mpeg",
          });
        if (upErr) throw new Error(upErr.message);
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from("voicemail-variable-clips")
        .createSignedUrl(path, 300);
      if (signErr || !signed?.signedUrl) {
        // Don't silently drop the segment — that produces a broken voicemail.
        throw new Error(`Couldn't prepare the "${seg.token}" clip — please try again.`);
      }
      out.push({ type: "variable", token: seg.token, value, url: signed.signedUrl });
    }

    return { voiceId, segments: out };
  });
