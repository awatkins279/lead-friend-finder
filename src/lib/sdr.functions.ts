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
