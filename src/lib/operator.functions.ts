import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idSchema = z.object({ id: z.string().uuid() });

export const listOperatorThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db.from("operator_threads").select("id,title,updated_at").eq("user_id", context.userId).order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { threads: data ?? [] };
  });

export const createOperatorThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ title: z.string().trim().min(1).max(160).default("New campaign plan") }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: thread, error } = await db.from("operator_threads").insert({ user_id: context.userId, title: data.title }).select("id,title,updated_at").single();
    if (error || !thread) throw new Error(error?.message ?? "Could not create conversation");
    return { thread };
  });

export const deleteOperatorThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db.from("operator_threads").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getOperatorWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ threadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: thread, error: threadError } = await db.from("operator_threads").select("id,title,updated_at").eq("id", data.threadId).eq("user_id", context.userId).maybeSingle();
    if (threadError || !thread) throw new Error("Conversation not found");
    const [messages, blueprints, events] = await Promise.all([
      db.from("operator_messages").select("message").eq("thread_id", data.threadId).eq("user_id", context.userId).order("created_at"),
      db.from("operator_blueprints").select("id,version,offer_brief,strategy,guardrails,status,approved_at,updated_at").eq("thread_id", data.threadId).eq("user_id", context.userId).order("version", { ascending: false }).limit(1),
      db.from("operator_events").select("id,event_type,status,title,details,error,created_at").eq("thread_id", data.threadId).eq("user_id", context.userId).order("created_at", { ascending: false }).limit(80),
    ]);
    for (const result of [messages, blueprints, events]) if (result.error) throw new Error(result.error.message);
    return { thread, messages: (messages.data ?? []).map((row: any) => row.message), blueprint: blueprints.data?.[0] ?? null, events: events.data ?? [] };
  });

export const approveOperatorBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ blueprintId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: blueprint, error: readError } = await db.from("operator_blueprints").select("id,thread_id,status,offer_brief,strategy,guardrails").eq("id", data.blueprintId).eq("user_id", context.userId).maybeSingle();
    if (readError || !blueprint) throw new Error("Campaign plan not found");
    if (blueprint.status !== "draft") throw new Error("Only a draft plan can be approved");
    const { buildApprovedBlueprint } = await import("@/lib/operator-build.server");
    return buildApprovedBlueprint({ db, userId: context.userId, blueprint });
  });

export const pauseOperatorBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ blueprintId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: blueprint, error } = await db.from("operator_blueprints").update({ status: "paused" }).eq("id", data.blueprintId).eq("user_id", context.userId).in("status", ["approved", "running"]).select("id,thread_id").maybeSingle();
    if (error || !blueprint) throw new Error("This plan cannot be paused");
    await db.from("operator_events").update({ status: "paused" }).eq("blueprint_id", blueprint.id).eq("user_id", context.userId).eq("event_type", "operator_pipeline").eq("status", "running");
    await db.from("operator_events").insert({ thread_id: blueprint.thread_id, blueprint_id: blueprint.id, user_id: context.userId, event_type: "operator_paused", status: "paused", title: "Operator paused by user" });
    return { ok: true };
  });

export const resumeOperatorBlueprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ blueprintId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: blueprint, error } = await db.from("operator_blueprints").update({ status: "running" }).eq("id", data.blueprintId).eq("user_id", context.userId).eq("status", "paused").select("id,thread_id,offer_brief,strategy,guardrails").maybeSingle();
    if (error || !blueprint) throw new Error("This plan is not paused or cannot be resumed");
    const { data: pipelines } = await db.from("operator_events").select("id,status").eq("blueprint_id", blueprint.id).eq("user_id", context.userId).eq("event_type", "operator_pipeline");
    if ((pipelines ?? []).length > 0) {
      await db.from("operator_events").update({ status: "running" }).eq("blueprint_id", blueprint.id).eq("user_id", context.userId).eq("event_type", "operator_pipeline").eq("status", "paused");
    } else {
      const { data: campaignEvents } = await db.from("operator_events").select("details").eq("blueprint_id", blueprint.id).eq("user_id", context.userId).eq("event_type", "campaign_draft_created").order("created_at");
      const plays = Array.isArray(blueprint.strategy?.plays) ? blueprint.strategy.plays : [];
      const { startOperatorPipeline } = await import("@/lib/operator-execution.server");
      let remainingLeads = Math.min(100_000, Math.max(1, Math.floor(Number(blueprint.guardrails?.maxLeads ?? 100_000))));
      for (let index = 0; index < Math.min(plays.length, campaignEvents?.length ?? 0); index += 1) {
        if (remainingLeads <= 0) break;
        const campaignId = campaignEvents[index]?.details?.campaign_id;
        if (typeof campaignId !== "string") continue;
        const playLeads = Math.min(remainingLeads, Math.max(1, Math.floor(Number(plays[index]?.estimatedAudience ?? remainingLeads))));
        await startOperatorPipeline({
          db,
          userId: context.userId,
          threadId: blueprint.thread_id,
          blueprintId: blueprint.id,
          campaignId,
          offerBrief: String(blueprint.offer_brief),
          play: plays[index],
          maxLeads: playLeads,
          scoreThreshold: 60,
        });
        remainingLeads -= playLeads;
      }
    }
    await db.from("operator_events").insert({ thread_id: blueprint.thread_id, blueprint_id: blueprint.id, user_id: context.userId, event_type: "operator_resumed", status: "completed", title: "Operator resumed by user" });
    return { ok: true };
  });