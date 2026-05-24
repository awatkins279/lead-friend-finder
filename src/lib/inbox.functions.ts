import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const filtersSchema = z.object({
  status: z.enum(["all", "open", "needs_approval", "archived", "snoozed", "closed"]).optional(),
  unread_only: z.boolean().optional(),
  campaign_ids: z.array(z.string().uuid()).optional(),
  account_ids: z.array(z.string().uuid()).optional(),
  intents: z.array(z.string()).optional(),
  date_from: z.string().nullish(),
  date_to: z.string().nullish(),
  search: z.string().max(200).nullish(),
});

export type InboxFilters = z.infer<typeof filtersSchema>;

const applyFilters = (q: ReturnType<typeof buildBase>, f: InboxFilters) => {
  if (f.status && f.status !== "all") q = q.eq("status", f.status);
  if (f.unread_only) q = q.gt("unread_count", 0);
  if (f.campaign_ids?.length) q = q.in("list_id", f.campaign_ids);
  if (f.account_ids?.length) q = q.in("email_account_id", f.account_ids);
  if (f.intents?.length) q = q.in("intent", f.intents);
  if (f.date_from) q = q.gte("last_message_at", f.date_from);
  if (f.date_to) q = q.lte("last_message_at", f.date_to);
  if (f.search) {
    const s = `%${f.search}%`;
    q = q.or(
      `subject.ilike.${s},lead_email.ilike.${s},lead_name.ilike.${s},company.ilike.${s}`,
    );
  }
  return q;
};

// dummy helper to type the builder
const buildBase = (sb: { from: (n: string) => { select: (s: string) => unknown } }) =>
  sb.from("sdr_conversations").select("*") as unknown as {
    eq: (k: string, v: unknown) => ReturnType<typeof buildBase>;
    gt: (k: string, v: unknown) => ReturnType<typeof buildBase>;
    in: (k: string, v: unknown[]) => ReturnType<typeof buildBase>;
    gte: (k: string, v: unknown) => ReturnType<typeof buildBase>;
    lte: (k: string, v: unknown) => ReturnType<typeof buildBase>;
    or: (s: string) => ReturnType<typeof buildBase>;
    order: (k: string, o: { ascending: boolean }) => ReturnType<typeof buildBase>;
    limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtersSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("sdr_conversations")
      .select(
        "id, lead_email, lead_name, company, subject, last_message_at, last_direction, unread_count, intent, status, list_id, email_account_id, agent_id, lists(name), email_accounts(email_address), sdr_agents(name, sdr_display_name)",
      );

    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    else q = q.neq("status", "archived");
    if (data.unread_only) q = q.gt("unread_count", 0);
    if (data.campaign_ids?.length) q = q.in("list_id", data.campaign_ids);
    if (data.account_ids?.length) q = q.in("email_account_id", data.account_ids);
    if (data.intents?.length) q = q.in("intent", data.intents);
    if (data.date_from) q = q.gte("last_message_at", data.date_from);
    if (data.date_to) q = q.lte("last_message_at", data.date_to);
    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(
        `subject.ilike.${s},lead_email.ilike.${s},lead_name.ilike.${s},company.ilike.${s}`,
      );
    }

    const { data: rows, error } = await q
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { conversations: rows ?? [] };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: convo, error: e1 }, { data: msgs, error: e2 }] = await Promise.all([
      supabase
        .from("sdr_conversations")
        .select(
          "*, lists(name), email_accounts(email_address, provider), sdr_agents(name, sdr_display_name)",
        )
        .eq("id", data.id)
        .maybeSingle(),
      supabase
        .from("sdr_messages")
        .select("*")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (!convo) throw new Error("Conversation not found");
    // Mark as read
    if ((convo as { unread_count: number }).unread_count > 0) {
      await supabase
        .from("sdr_conversations")
        .update({ unread_count: 0 })
        .eq("id", data.id);
    }
    return { conversation: convo, messages: msgs ?? [] };
  });

export const setConversationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "needs_approval", "archived", "snoozed", "closed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sdr_conversations")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setConversationIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        intent: z.string().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sdr_conversations")
      .update({ intent: data.intent })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveDraftReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversation_id: z.string().uuid(),
        body: z.string().min(1).max(20000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: convo, error: cErr } = await supabase
      .from("sdr_conversations")
      .select("subject, lead_email, agent_id, email_accounts(email_address)")
      .eq("id", data.conversation_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!convo) throw new Error("Conversation not found");
    const from = (convo as { email_accounts: { email_address: string } | null }).email_accounts
      ?.email_address ?? "pending@inbox";
    const { data: inserted, error } = await supabase
      .from("sdr_messages")
      .insert({
        conversation_id: data.conversation_id,
        user_id: userId,
        direction: "outbound",
        from_email: from,
        to_emails: [(convo as { lead_email: string }).lead_email],
        subject: (convo as { subject: string | null }).subject ?? "Re:",
        body_text: data.body,
        snippet: data.body.slice(0, 200),
        ai_generated: false,
        agent_id: (convo as { agent_id: string | null }).agent_id,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

export const approveAndSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ message_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // No inbox credentials yet — flip to queued so the future sender picks it up.
    const { error } = await context.supabase
      .from("sdr_messages")
      .update({ status: "queued" })
      .eq("id", data.message_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getInboxAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtersSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("sdr_conversations")
      .select("id, intent, status, list_id, last_message_at, meeting_booked_at, lists(name)");
    if (data.campaign_ids?.length) q = q.in("list_id", data.campaign_ids);
    if (data.account_ids?.length) q = q.in("email_account_id", data.account_ids);
    if (data.date_from) q = q.gte("last_message_at", data.date_from);
    if (data.date_to) q = q.lte("last_message_at", data.date_to);
    const { data: rows, error } = await q.limit(2000);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      intent: string | null;
      status: string;
      list_id: string | null;
      meeting_booked_at: string | null;
      lists: { name: string } | null;
    }>;

    const intentCounts: Record<string, number> = {};
    const campaignCounts: Record<string, { name: string; count: number }> = {};
    let meetings = 0;
    for (const r of list) {
      const i = r.intent ?? "unclassified";
      intentCounts[i] = (intentCounts[i] ?? 0) + 1;
      if (r.list_id) {
        const name = r.lists?.name ?? "Untitled";
        campaignCounts[r.list_id] = {
          name,
          count: (campaignCounts[r.list_id]?.count ?? 0) + 1,
        };
      }
      if (r.meeting_booked_at) meetings += 1;
    }

    return {
      total: list.length,
      meetings,
      intent_counts: intentCounts,
      campaigns: Object.entries(campaignCounts)
        .map(([id, v]) => ({ id, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  });

export const listInboxFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [{ data: campaigns }, { data: accounts }] = await Promise.all([
      supabase.from("lists").select("id, name").order("created_at", { ascending: false }),
      supabase
        .from("email_accounts")
        .select("id, email_address")
        .order("created_at", { ascending: false }),
    ]);
    return {
      campaigns: campaigns ?? [],
      accounts: accounts ?? [],
    };
  });
