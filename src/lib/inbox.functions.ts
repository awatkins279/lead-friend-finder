import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SDR_REPLY_SYSTEM_PROMPT, buildKnowledgeBlock } from "./sdr-reply-prompt";

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

// ============== AI reply generation (grounded, draft-only) ==============
//
// Reads the conversation + the assigned agent's config + that agent's knowledge
// base, then drafts a grounded reply with the anti-hallucination system prompt.
// ALWAYS saves as a draft (never sends). Stores the model's self-confidence and
// any handoff flag in the message's `raw` column for the UI to surface.

function tryParseJson(raw: string): Record<string, unknown> | null {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[{[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const repaired = s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

export const generateAgentReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversation_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Conversation (+ campaign fallback for the agent, + the sending inbox).
    const { data: convoRaw, error: cErr } = await supabase
      .from("sdr_conversations")
      .select(
        "id, lead_email, lead_name, company, subject, agent_id, list_id, lists(sdr_agent_id), email_accounts(email_address)",
      )
      .eq("id", data.conversation_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!convoRaw) throw new Error("Conversation not found");
    const convo = convoRaw as unknown as {
      id: string;
      lead_email: string;
      lead_name: string | null;
      company: string | null;
      subject: string | null;
      agent_id: string | null;
      lists: { sdr_agent_id: string | null } | null;
      email_accounts: { email_address: string } | null;
    };

    const agentId = convo.agent_id ?? convo.lists?.sdr_agent_id ?? null;
    if (!agentId) {
      throw new Error(
        "No SDR agent is assigned to this conversation or its campaign. Assign one first.",
      );
    }

    // 2. Agent config, thread, this agent's knowledge, and — Tier 1 web research —
    // any CRM record we already hold on this prospect (matched by email). All in parallel.
    const [
      { data: agent, error: aErr },
      { data: msgs, error: mErr },
      { data: chunks },
      { data: leadRow },
    ] = await Promise.all([
      supabase.from("sdr_agents").select("*").eq("id", agentId).maybeSingle(),
      supabase
        .from("sdr_messages")
        .select("direction, from_name, body_text, created_at")
        .eq("conversation_id", data.conversation_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("sdr_knowledge_chunks")
        .select("content")
        .eq("agent_id", agentId)
        .order("chunk_index", { ascending: true })
        .limit(100),
      supabase
        .from("leads")
        .select(
          "title, org_name, org_industry, org_employee_count, org_technologies_used, org_website_url, org_description, city, state, country, linkedin_url",
        )
        .eq("email", convo.lead_email)
        .limit(1)
        .maybeSingle(),
    ]);
    if (aErr) throw new Error(aErr.message);
    if (mErr) throw new Error(mErr.message);
    if (!agent) throw new Error("Assigned agent not found");

    // Tier 1 "research": structured facts we already know about the prospect's
    // company. Reliable (not scraped) — used to personalize, never to invent.
    const lead = (leadRow ?? null) as Record<string, any> | null;
    const intelLines = lead
      ? [
          lead.title ? `Prospect title: ${lead.title}` : "",
          lead.org_name ? `Company: ${lead.org_name}` : "",
          lead.org_industry ? `Industry: ${lead.org_industry}` : "",
          lead.org_employee_count ? `Headcount: ${lead.org_employee_count}` : "",
          lead.org_technologies_used ? `Tech stack: ${lead.org_technologies_used}` : "",
          lead.org_website_url ? `Website: ${lead.org_website_url}` : "",
          [lead.city, lead.state, lead.country].filter(Boolean).length
            ? `Location: ${[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}`
            : "",
          lead.org_description ? `About: ${String(lead.org_description).slice(0, 800)}` : "",
        ].filter(Boolean)
      : [];
    const prospectIntel = intelLines.join("\n");

    const a = agent as Record<string, any>;
    const { text: knowledge, truncated } = buildKnowledgeBlock(
      (chunks ?? []) as { content: string }[],
    );

    // 3. Keyword handoff pre-check on the latest inbound message.
    const triggers = String(a.handoff_triggers ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const messages = (msgs ?? []) as {
      direction: string;
      from_name: string | null;
      body_text: string | null;
    }[];
    const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
    const lastInboundText = (lastInbound?.body_text ?? "").toLowerCase();
    const flagged = triggers.filter((t) => lastInboundText.includes(t));

    // 4. Build the user prompt from the seller profile + knowledge + thread.
    const sdrName = a.sdr_display_name || a.name || "the rep";
    const profileLines = [
      `SDR display name: ${sdrName}`,
      `Tone: ${a.tone ?? "consultative"}`,
      `Formality (0 casual – 100 formal): ${a.formality ?? 50}`,
      a.what_selling ? `What we sell: ${a.what_selling}` : "",
      a.key_differentiators ? `Differentiators: ${a.key_differentiators}` : "",
      a.booking_url ? `Booking link (offer when it fits): ${a.booking_url}` : "",
      a.extra_instructions ? `Playbook notes: ${a.extra_instructions}` : "",
      a.hard_rules ? `HARD RULES (absolute):\n${a.hard_rules}` : "",
      a.signature ? `Signature to end with:\n${a.signature}` : "",
    ].filter(Boolean);

    const threadText = messages
      .map((m) => {
        const who = m.direction === "inbound" ? "PROSPECT" : `US (${sdrName})`;
        return `${who}:\n${(m.body_text ?? "").slice(0, 4000)}`;
      })
      .join("\n\n---\n\n");

    const userPrompt = `SELLER PROFILE:
${profileLines.join("\n")}

KNOWLEDGE BASE${truncated ? " (partial — truncated; if a needed fact may be missing, lower confidence)" : knowledge ? "" : " (EMPTY — you have no product facts beyond the seller profile; do not invent any, defer to a human/call for specifics)"}:
${knowledge || "(none provided)"}

PROSPECT CONTEXT:
- Name: ${convo.lead_name ?? "unknown"}
- Company: ${convo.company ?? "unknown"}
- Subject: ${convo.subject ?? "(none)"}
${prospectIntel ? `\nPROSPECT INTEL (facts we already hold on this prospect's company — use to personalize naturally; do NOT invent beyond this, and never use it to make claims about OUR product):\n${prospectIntel}\n` : ""}
THREAD (oldest to newest — reply to the latest PROSPECT message):
${threadText || "(no messages)"}

${flagged.length ? `SYSTEM FLAG: This message hit handoff trigger(s): ${flagged.join(", ")}. Treat as requiring human handoff.` : ""}

Write the reply now as JSON.`;

    // 5. Call the AI gateway.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SDR_REPLY_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
      }),
    });
    if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
    if (res.status === 402)
      throw new Error("AI credits exhausted — add credits in Workspace settings");
    if (!res.ok) throw new Error(`AI error ${res.status}`);

    const payload = await res.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "{}";
    const parsed = tryParseJson(content);
    if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
      throw new Error("The AI returned an unreadable reply — try again");
    }

    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 50;
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));
    const needsHandoff = parsed.needs_handoff === true || flagged.length > 0;
    if (needsHandoff) confidence = Math.min(confidence, 40);
    const handoffReason =
      typeof parsed.handoff_reason === "string" ? parsed.handoff_reason : "";
    const replyBody = String(parsed.reply).slice(0, 20000);

    // 6. Save as a DRAFT (never send). Stash metadata in `raw`.
    const subject = convo.subject
      ? convo.subject.toLowerCase().startsWith("re:")
        ? convo.subject
        : `Re: ${convo.subject}`
      : "Re:";
    const from = convo.email_accounts?.email_address ?? "pending@inbox";
    const { data: inserted, error: insErr } = await supabase
      .from("sdr_messages")
      .insert({
        conversation_id: convo.id,
        user_id: userId,
        direction: "outbound",
        from_email: from,
        to_emails: [convo.lead_email],
        subject,
        body_text: replyBody,
        snippet: replyBody.slice(0, 200),
        ai_generated: true,
        agent_id: agentId,
        status: "draft",
        raw: {
          confidence,
          needs_handoff: needsHandoff,
          handoff_reason: handoffReason,
          knowledge_chunks: (chunks ?? []).length,
          knowledge_truncated: truncated,
          model: "google/gemini-2.5-flash",
        },
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // Flag the conversation for review.
    await supabase
      .from("sdr_conversations")
      .update({ status: "needs_approval" })
      .eq("id", convo.id);

    return {
      message_id: inserted.id as string,
      reply: replyBody,
      confidence,
      needs_handoff: needsHandoff,
      handoff_reason: handoffReason,
      knowledge_used: (chunks ?? []).length,
    };
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
