import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatCompletion } from "@/lib/ai-client";
import { NEPQ_KNOWLEDGE } from "@/lib/coaching-knowledge/nepq";

// ---------------------------------------------------------------------------
// COACHING STYLES (admin curated)
// ---------------------------------------------------------------------------

export type CoachingStyle = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  hard_rules: string | null;
  example_objection_handlers: { objection: string; response: string }[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export const listCoachingStyles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ styles: CoachingStyle[]; isAdmin: boolean }> => {
    const { supabase, userId } = context;
    const [{ data, error }, { data: roleRow }] = await Promise.all([
      supabase
        .from("coaching_styles")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name"),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    return {
      styles: (data ?? []) as unknown as CoachingStyle[],
      isAdmin: !!roleRow,
    };
  });

const upsertStyleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  system_prompt: z.string().min(20).max(20000),
  hard_rules: z.string().max(5000).nullish(),
  example_objection_handlers: z
    .array(
      z.object({ objection: z.string().min(1).max(200), response: z.string().min(1).max(2000) }),
    )
    .max(20)
    .default([]),
  is_default: z.boolean().default(false),
});

export const upsertCoachingStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertStyleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.is_default) {
      await supabase
        .from("coaching_styles")
        .update({ is_default: false })
        .neq("id", data.id ?? "00000000-0000-0000-0000-000000000000");
    }

    if (data.id) {
      const { error } = await supabase
        .from("coaching_styles")
        .update({
          name: data.name,
          description: data.description ?? null,
          system_prompt: data.system_prompt,
          hard_rules: data.hard_rules ?? null,
          example_objection_handlers: data.example_objection_handlers as any,
          is_default: data.is_default,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("coaching_styles")
      .insert({
        name: data.name,
        description: data.description ?? null,
        system_prompt: data.system_prompt,
        hard_rules: data.hard_rules ?? null,
        example_objection_handlers: data.example_objection_handlers as any,
        is_default: data.is_default,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteCoachingStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("coaching_styles").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// CAMPAIGN COACHING CONFIG
// ---------------------------------------------------------------------------

const setListCoachingSchema = z.object({
  list_id: z.string().uuid(),
  coaching_style_id: z.string().uuid().nullable(),
  ai_copilot_enabled: z.boolean(),
});

export const setListCoaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => setListCoachingSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("lists")
      .update({
        coaching_style_id: data.coaching_style_id,
        ai_copilot_enabled: data.ai_copilot_enabled,
      })
      .eq("id", data.list_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// CAMPAIGN KNOWLEDGE BASE (per-list customer uploads)
// ---------------------------------------------------------------------------

export const listCampaignKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ list_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: docs, error } = await context.supabase
      .from("coaching_knowledge_docs")
      .select("id, filename, mime_type, size_bytes, status, error, chunk_count, created_at")
      .eq("list_id", data.list_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { docs: docs ?? [] };
  });

// Simple text chunker — ~800 chars with 100 char overlap, breaks on whitespace.
function chunkText(input: string, size = 800, overlap = 100): string[] {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > i + 200) end = lastSpace;
    }
    out.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

const addKnowledgeSchema = z.object({
  list_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  content: z.string().min(20).max(500_000),
  mime_type: z.string().max(120).default("text/plain"),
});

export const addCampaignKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => addKnowledgeSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ensure list belongs to this user
    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("id", data.list_id)
      .maybeSingle();
    if (!list) throw new Error("Campaign not found");

    const chunks = chunkText(data.content);
    if (chunks.length === 0) throw new Error("No usable content");

    const storagePath = `${userId}/${data.list_id}/${Date.now()}-${data.filename.replace(/[^\w.\-]/g, "_")}`;

    // Save raw text to storage (for retrieval / re-chunking later)
    const blob = new Blob([data.content], { type: data.mime_type || "text/plain" });
    const { error: upErr } = await supabase.storage
      .from("coaching-knowledge")
      .upload(storagePath, blob, {
        contentType: data.mime_type || "text/plain",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: doc, error: docErr } = await supabase
      .from("coaching_knowledge_docs")
      .insert({
        user_id: userId,
        list_id: data.list_id,
        filename: data.filename,
        storage_path: storagePath,
        mime_type: data.mime_type || "text/plain",
        size_bytes: data.content.length,
        status: "indexed",
        chunk_count: chunks.length,
      })
      .select("id")
      .single();
    if (docErr) throw new Error(docErr.message);

    const rows = chunks.map((content, idx) => ({
      doc_id: doc.id,
      list_id: data.list_id,
      user_id: userId,
      chunk_index: idx,
      content,
      token_count: Math.ceil(content.length / 4),
    }));
    const { error: chunkErr } = await supabase.from("coaching_knowledge_chunks").insert(rows);
    if (chunkErr) throw new Error(chunkErr.message);

    return { doc_id: doc.id, chunk_count: chunks.length };
  });

export const deleteCampaignKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc } = await supabase
      .from("coaching_knowledge_docs")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (doc?.storage_path) {
      await supabase.storage.from("coaching-knowledge").remove([doc.storage_path]);
    }
    const { error } = await supabase.from("coaching_knowledge_docs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// LIVE: Deepgram temporary key
// ---------------------------------------------------------------------------

export const getDeepgramToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ key: string; expires_at: string }> => {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY");

    // Get the project id, then mint a short-lived member key.
    const projRes = await fetch("https://api.deepgram.com/v1/projects", {});
    if (!projRes.ok) throw new Error(`Deepgram projects ${projRes.status}`);
    const projJson = await projRes.json();
    const projectId: string | undefined = projJson?.projects?.[0]?.project_id;
    if (!projectId) throw new Error("No Deepgram project found");

    const ttlSeconds = 60 * 30; // 30 minutes
    const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        comment: "live-call-copilot",
        scopes: ["usage:write"],
        time_to_live_in_seconds: ttlSeconds,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Deepgram key ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
    return {
      key: json.key as string,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  });

// ---------------------------------------------------------------------------
// LIVE: Generate a coaching suggestion from a transcript window
// ---------------------------------------------------------------------------

const suggestSchema = z.object({
  list_id: z.string().uuid(),
  lead_id: z.string().min(1),
  call_id: z.string().uuid().optional(),
  transcript: z
    .array(z.object({ role: z.enum(["rep", "prospect"]), text: z.string().min(1).max(2000) }))
    .min(1)
    .max(40),
});

export type LiveSuggestion = {
  intent: "objection" | "discovery" | "close" | "rapport" | "continue";
  prospect_quote: string;
  suggestion: string;
  why: string;
};

export const generateLiveSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => suggestSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ suggestion: LiveSuggestion }> => {
    const { supabase, userId } = context;

    const [{ data: list }, { data: lead }, { data: profile }] = await Promise.all([
      supabase
        .from("lists")
        .select(
          "what_selling, key_selling_points, sender_name, sender_company, coaching_style_id, ai_copilot_enabled",
        )
        .eq("id", data.list_id)
        .maybeSingle(),
      supabase
        .from("leads")
        .select("first_name,last_name,title,org_name,org_industry")
        .eq("id", data.lead_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select(
          "company_name,product_name,product_description,product_value_props,ideal_customer,common_objections,proof_points,pricing_notes,competitors,call_to_action",
        )
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (!list) throw new Error("Campaign not found");

    // Resolve coaching style: pick selected, else default.
    let style: CoachingStyle | null = null;
    if (list.coaching_style_id) {
      const { data: s } = await supabase
        .from("coaching_styles")
        .select("*")
        .eq("id", list.coaching_style_id)
        .maybeSingle();
      style = (s ?? null) as unknown as CoachingStyle | null;
    }
    if (!style) {
      const { data: s } = await supabase
        .from("coaching_styles")
        .select("*")
        .eq("is_default", true)
        .maybeSingle();
      style = (s ?? null) as unknown as CoachingStyle | null;
    }

    const lastProspect =
      [...data.transcript].reverse().find((t) => t.role === "prospect")?.text ?? "";

    // Fetch the rep's next 3 available meeting slots so the AI can pitch real times
    // (used on closes when the prospect agrees to a meeting).
    let availabilityBlock = "";
    try {
      const { data: prefsRow } = await supabase
        .from("scheduling_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      const prefs: any = prefsRow ?? {
        timezone: "America/New_York",
        workday_start_minute: 540,
        workday_end_minute: 1020,
        meeting_duration_minutes: 30,
        buffer_minutes: 15,
        workdays: [1, 2, 3, 4, 5],
      };
      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 86400000);
      const { data: existing } = await supabase
        .from("meetings")
        .select("starts_at,ends_at")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", horizon.toISOString())
        .neq("status", "cancelled");
      const busy = (existing ?? []).map((m: any) => ({
        start: new Date(m.starts_at).getTime(),
        end: new Date(m.ends_at).getTime(),
      }));
      const slotMs = prefs.meeting_duration_minutes * 60000;
      const bufferMs = prefs.buffer_minutes * 60000;
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: prefs.timezone,
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const tzParts = (d: Date) => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: prefs.timezone,
          weekday: "short",
          hour: "numeric",
          minute: "numeric",
          hour12: false,
        }).formatToParts(d);
        const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
        const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
        const min = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
        return {
          dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd),
          minuteOfDay: hour * 60 + min,
        };
      };
      const slots: string[] = [];
      let cursor = new Date(Math.ceil((now.getTime() + 30 * 60000) / (15 * 60000)) * (15 * 60000));
      let guard = 0;
      while (slots.length < 3 && cursor < horizon && guard++ < 2000) {
        const { dow, minuteOfDay } = tzParts(cursor);
        const inDay = (prefs.workdays as number[]).includes(dow);
        const inHours =
          minuteOfDay >= prefs.workday_start_minute &&
          minuteOfDay + prefs.meeting_duration_minutes <= prefs.workday_end_minute;
        if (inDay && inHours) {
          const start = cursor.getTime();
          const end = start + slotMs;
          const conflict = busy.some((b) => start < b.end + bufferMs && end + bufferMs > b.start);
          if (!conflict) {
            slots.push(fmt.format(new Date(start)));
            cursor = new Date(end + bufferMs);
            continue;
          }
        }
        cursor = new Date(cursor.getTime() + 15 * 60000);
      }
      if (slots.length) {
        availabilityBlock = `\nREP'S NEXT OPEN SLOTS (use these EXACT times when the prospect agrees to a meeting — never invent times):\n${slots.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
      }
    } catch {
      // non-fatal — AI just won't have specific times to pitch
    }

    // Retrieve top knowledge chunks via trigram similarity on the prospect's last utterance.
    let knowledge: string[] = [];
    if (lastProspect.length > 5) {
      const { data: chunks } = await supabase
        .from("coaching_knowledge_chunks")
        .select("content")
        .eq("list_id", data.list_id)
        .textSearch("content", lastProspect.split(/\s+/).slice(0, 8).join(" "), {
          type: "websearch",
          config: "english",
        })
        .limit(3);
      knowledge = (chunks ?? []).map((c: any) => c.content as string);
    }

    const isNEPQ = /nepq|jeremy\s*miner/i.test(style?.name ?? "");
    const knowledgeBlock = isNEPQ
      ? `\n\n=== METHODOLOGY TRAINING (NEPQ — Jeremy Miner) ===\nThis is the full training the rep is being coached on. Every suggestion you produce MUST be consistent with these rules, tones, question types, and banned phrases.\n\n${NEPQ_KNOWLEDGE}\n=== END METHODOLOGY TRAINING ===\n`
      : "";

    const systemPrompt = `${style?.system_prompt ?? "You are an elite cold-call coach. Tell the rep exactly what to say next in 1-3 sentences."}
${knowledgeBlock}
${style?.hard_rules ? `HARD RULES:\n${style.hard_rules}` : ""}

You are listening to a LIVE cold call. Output JSON only:
{"intent":"objection"|"discovery"|"close"|"rapport"|"continue","prospect_quote":"<the exact line that triggered this>","suggestion":"<1-3 sentences the rep should say RIGHT NOW>","why":"<1 short sentence on why this works in this style>"}`;

    const p: any = profile ?? {};
    const productBlock = [
      p.company_name && `Company: ${p.company_name}`,
      p.product_name && `Product: ${p.product_name}`,
      p.product_description && `What it is: ${p.product_description}`,
      p.product_value_props && `Value props:\n${p.product_value_props}`,
      p.ideal_customer && `Ideal customer: ${p.ideal_customer}`,
      p.common_objections && `Common objections + handlers:\n${p.common_objections}`,
      p.proof_points && `Proof points:\n${p.proof_points}`,
      p.pricing_notes && `Pricing guidance: ${p.pricing_notes}`,
      p.competitors && `Competitors: ${p.competitors}`,
      p.call_to_action && `Default CTA: ${p.call_to_action}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const userPrompt = `PRODUCT BRAIN (always-on context)
${productBlock || "(none configured — tell the user to fill in /app/product-info)"}

CAMPAIGN CONTEXT
Rep: ${list.sender_name ?? "the rep"} from ${list.sender_company ?? p.company_name ?? "—"}
Selling: ${list.what_selling ?? p.product_name ?? "—"}
${list.key_selling_points ? `Campaign-specific points: ${list.key_selling_points}` : ""}

PROSPECT
${[lead?.first_name, lead?.last_name].filter(Boolean).join(" ")} — ${lead?.title ?? "?"} at ${lead?.org_name ?? "?"} (${lead?.org_industry ?? "?"})

${knowledge.length ? `RELEVANT UPLOADED KNOWLEDGE:\n${knowledge.map((k, i) => `[${i + 1}] ${k}`).join("\n\n")}\n` : ""}
${availabilityBlock}
${
  style?.example_objection_handlers?.length
    ? `STYLE EXAMPLES:\n${style.example_objection_handlers
        .slice(0, 5)
        .map((o) => `- "${o.objection}" → "${o.response}"`)
        .join("\n")}\n`
    : ""
}
LIVE TRANSCRIPT (oldest → newest):
${data.transcript.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join("\n")}
Return the JSON now.`;

    const content = await chatCompletion({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });

    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    const suggestion: LiveSuggestion = {
      intent: ["objection", "discovery", "close", "rapport", "continue"].includes(parsed.intent)
        ? parsed.intent
        : "continue",
      prospect_quote: String(parsed.prospect_quote ?? lastProspect).slice(0, 400),
      suggestion: String(parsed.suggestion ?? "").slice(0, 1200),
      why: String(parsed.why ?? "").slice(0, 400),
    };

    // Persist for replay / training
    if (data.call_id) {
      await supabase.from("call_live_events").insert({
        call_id: data.call_id,
        user_id: userId,
        kind: "suggestion",
        text: suggestion.suggestion,
        meta: suggestion as any,
      });
    }

    return { suggestion };
  });

// ---------------------------------------------------------------------------
// LIVE: persist a transcript chunk
// ---------------------------------------------------------------------------

const logTranscriptSchema = z.object({
  call_id: z.string().uuid(),
  role: z.enum(["rep", "prospect"]),
  text: z.string().min(1).max(2000),
});

export const logTranscriptChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => logTranscriptSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("call_live_events").insert({
      call_id: data.call_id,
      user_id: context.userId,
      kind: "transcript",
      role: data.role,
      text: data.text,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
