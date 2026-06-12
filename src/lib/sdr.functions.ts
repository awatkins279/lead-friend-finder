import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============== Schemas ==============

const upsertAgentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  sdr_display_name: z.string().max(100).nullish(),
  signature: z.string().max(2000).nullish(),
  tone: z.enum(["friendly", "consultative", "direct", "playful"]),
  formality: z.number().int().min(0).max(100),
  mode: z.enum(["draft", "approve", "auto"]),
  response_speed: z.enum(["instant", "fast", "medium", "slow"]),
  confidence_threshold: z.number().int().min(0).max(100),
  booking_url: z.string().url().nullish().or(z.literal("")),
  hard_rules: z.string().max(4000).nullish(),
  handoff_triggers: z.string().max(2000).nullish(),
  what_selling: z.string().max(4000).nullish(),
  key_differentiators: z.string().max(4000).nullish(),
  extra_instructions: z.string().max(4000).nullish(),
  email_account_id: z.string().uuid().nullish(),
});

const idSchema = z.object({ id: z.string().uuid() });

// ============== Agents CRUD ==============

type AgentListRow = {
  id: string;
  name: string;
  sdr_display_name: string | null;
  tone: string;
  mode: string;
  response_speed: string;
  email_account_id: string | null;
  inbox_email: string | null;
  inbox_provider: string | null;
  inbox_status: string | null;
  sdr_knowledge_docs: { count: number }[];
  lists: { count: number }[];
};

export const listSdrAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("sdr_agents")
      .select(
        "id, name, sdr_display_name, tone, mode, response_speed, email_account_id, sdr_knowledge_docs(count), lists(count), email_accounts(email_address, provider, status)"
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const agents: AgentListRow[] = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string;
        name: string;
        sdr_display_name: string | null;
        tone: string;
        mode: string;
        response_speed: string;
        email_account_id: string | null;
        sdr_knowledge_docs: { count: number }[];
        lists: { count: number }[];
        email_accounts: { email_address: string; provider: string; status: string } | null;
      };
      return {
        id: r.id,
        name: r.name,
        sdr_display_name: r.sdr_display_name,
        tone: r.tone,
        mode: r.mode,
        response_speed: r.response_speed,
        email_account_id: r.email_account_id,
        inbox_email: r.email_accounts?.email_address ?? null,
        inbox_provider: r.email_accounts?.provider ?? null,
        inbox_status: r.email_accounts?.status ?? null,
        sdr_knowledge_docs: r.sdr_knowledge_docs ?? [],
        lists: r.lists ?? [],
      };
    });
    return { agents };
  });

export const getSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: agent, error: e1 }, { data: docs, error: e2 }] = await Promise.all([
      supabase.from("sdr_agents").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("sdr_knowledge_docs")
        .select("*")
        .eq("agent_id", data.id)
        .order("created_at", { ascending: false }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!agent) throw new Error("Agent not found");
    return { agent, docs: docs ?? [] };
  });

export const upsertSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => upsertAgentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      ...data,
      booking_url: data.booking_url || null,
      user_id: userId,
    };
    if (data.id) {
      const { error } = await supabase
        .from("sdr_agents")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await supabase
        .from("sdr_agents")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id };
    }
  });

export const deleteSdrAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("sdr_agents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== Knowledge docs ==============

const recordDocSchema = z.object({
  agent_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  storage_path: z.string().min(1),
  mime_type: z.string().max(120).nullish(),
  size_bytes: z.number().int().min(0).max(50 * 1024 * 1024),
});

export const recordKnowledgeDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recordDocSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: agent, error: aErr } = await supabase
      .from("sdr_agents")
      .select("id")
      .eq("id", data.agent_id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!agent) throw new Error("Agent not found");

    const { data: doc, error } = await supabase
      .from("sdr_knowledge_docs")
      .insert({
        agent_id: data.agent_id,
        user_id: userId,
        filename: data.filename,
        storage_path: data.storage_path,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { doc };
  });

export const deleteKnowledgeDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc, error: gErr } = await supabase
      .from("sdr_knowledge_docs")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (doc?.storage_path) {
      await supabase.storage.from("sdr-knowledge").remove([doc.storage_path]);
    }
    const { error } = await supabase
      .from("sdr_knowledge_docs")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== Assign to campaign ==============

const assignSchema = z.object({
  list_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
});

export const assignAgentToList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => assignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("lists")
      .update({ sdr_agent_id: data.agent_id })
      .eq("id", data.list_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== Knowledge ingestion (parse -> chunk -> store) ==============
//
// Turns an uploaded knowledge file into text chunks the SDR reply generator can
// ground on. Supports PDF, DOCX/DOC, TXT, MD. Parser libs are imported
// dynamically so they only load server-side (never in the browser bundle).
// Idempotent: re-running replaces this doc's chunks.

const CHUNK_CHARS = 2800; // ~700 tokens per chunk
const CHUNK_OVERLAP = 300; // carry-over context between chunks

function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  // Split on paragraph boundaries first, then pack into ~size windows.
  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > size) {
      // A single huge paragraph — hard-split it.
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += size - overlap) {
        chunks.push(p.slice(i, i + size));
      }
      continue;
    }
    if (cur.length + p.length + 2 > size) {
      chunks.push(cur);
      // start next chunk with a little overlap from the end of the previous one
      cur = cur.slice(-overlap) + "\n\n" + p;
    } else {
      cur += (cur ? "\n\n" : "") + p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.trim().length > 0);
}

async function extractTextFromFile(buf: Buffer, filename: string): Promise<string> {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
  if (ext === "docx" || ext === "doc") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  // txt, md, and anything else readable as plain text
  return buf.toString("utf-8");
}

export const processKnowledgeDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc, error: dErr } = await supabase
      .from("sdr_knowledge_docs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!doc) throw new Error("Document not found");

    await supabase
      .from("sdr_knowledge_docs")
      .update({ status: "processing", error: null })
      .eq("id", doc.id);

    try {
      const { data: blob, error: sErr } = await supabase.storage
        .from("sdr-knowledge")
        .download(doc.storage_path);
      if (sErr || !blob) throw new Error(sErr?.message ?? "Could not download file");

      const buf = Buffer.from(await blob.arrayBuffer());
      const text = await extractTextFromFile(buf, doc.filename);
      const chunks = chunkText(text);

      if (chunks.length === 0) {
        throw new Error("No readable text found in this file");
      }

      // Replace any existing chunks for this doc (idempotent re-process).
      await supabase.from("sdr_knowledge_chunks").delete().eq("doc_id", doc.id);

      const rows = chunks.map((content, i) => ({
        doc_id: doc.id,
        agent_id: doc.agent_id,
        user_id: userId,
        chunk_index: i,
        content,
        token_count: Math.ceil(content.length / 4),
      }));
      const { error: iErr } = await supabase.from("sdr_knowledge_chunks").insert(rows);
      if (iErr) throw new Error(iErr.message);

      await supabase
        .from("sdr_knowledge_docs")
        .update({ status: "processed", chunk_count: chunks.length, error: null })
        .eq("id", doc.id);

      return { ok: true, chunk_count: chunks.length };
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 500);
      await supabase
        .from("sdr_knowledge_docs")
        .update({ status: "error", error: msg })
        .eq("id", doc.id);
      throw new Error(msg);
    }
  });
