import { SDR_REPLY_SYSTEM_PROMPT, buildKnowledgeBlock } from "./sdr-reply-prompt";
import { instantlyListEmails, instantlySendReply } from "./instantly.functions";
import { chatCompletion } from "@/lib/ai-client";

type AdminClient = any;

function parseReply(raw: string) {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractInstantlyUuid(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const payload = raw as Record<string, unknown>;
  for (const key of ["reply_to_uuid", "email_id", "id", "message_uuid", "uuid"]) {
    const value = payload[key];
    if (typeof value === "string" && uuid.test(value)) return value;
  }
  return null;
}

export async function processSdrReplyJob(supabase: AdminClient, job: Record<string, any>) {
  const [{ data: conversation }, { data: agent }, { data: messages }, { data: chunks }] =
    await Promise.all([
      supabase
        .from("sdr_conversations")
        .select(
          "id, user_id, list_id, intent, lead_email, lead_name, company, subject, email_account_id, email_accounts(email_address)",
        )
        .eq("id", job.conversation_id)
        .maybeSingle(),
      supabase.from("sdr_agents").select("*").eq("id", job.agent_id).maybeSingle(),
      supabase
        .from("sdr_messages")
        .select("id, direction, body_text, raw, created_at")
        .eq("conversation_id", job.conversation_id)
        .order("created_at", { ascending: true }),
      supabase
        .from("sdr_knowledge_chunks")
        .select("content")
        .eq("agent_id", job.agent_id)
        .order("chunk_index", { ascending: true })
        .limit(100),
    ]);

  if (!conversation || !agent) throw new Error("Conversation or assigned agent no longer exists");

  const inbound = (messages ?? []).find((message: any) => message.id === job.inbound_message_id);
  if (!inbound) throw new Error("Inbound message no longer exists");

  const newerInbound = (messages ?? []).some(
    (message: any) =>
      message.direction === "inbound" &&
      message.id !== inbound.id &&
      new Date(message.created_at).getTime() > new Date(inbound.created_at).getTime(),
  );
  if (newerInbound) {
    await supabase
      .from("sdr_reply_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error: "Superseded by a newer inbound reply",
      })
      .eq("id", job.id);
    return { status: "cancelled" as const };
  }

  const triggers = String(agent.handoff_triggers ?? "")
    .split(",")
    .map((trigger) => trigger.trim().toLowerCase())
    .filter(Boolean);
  const inboundText = String(inbound.body_text ?? "").toLowerCase();
  const flagged = triggers.filter((trigger) => inboundText.includes(trigger));
  const sdrName = agent.sdr_display_name || agent.name || "the rep";
  const { text: knowledge, truncated } = buildKnowledgeBlock(chunks ?? []);
  const profile = [
    `SDR display name: ${sdrName}`,
    `Tone: ${agent.tone ?? "consultative"}`,
    `Formality (0 casual – 100 formal): ${agent.formality ?? 50}`,
    agent.what_selling ? `What we sell: ${agent.what_selling}` : "",
    agent.key_differentiators ? `Differentiators: ${agent.key_differentiators}` : "",
    agent.booking_url ? `Booking link (offer when it fits): ${agent.booking_url}` : "",
    agent.extra_instructions ? `Playbook notes: ${agent.extra_instructions}` : "",
    agent.hard_rules ? `HARD RULES (absolute):\n${agent.hard_rules}` : "",
    agent.signature ? `Signature to end with:\n${agent.signature}` : "",
  ].filter(Boolean);
  const thread = (messages ?? [])
    .map(
      (message: any) =>
        `${message.direction === "inbound" ? "PROSPECT" : `US (${sdrName})`}:\n${String(message.body_text ?? "").slice(0, 4000)}`,
    )
    .join("\n\n---\n\n");
  const prompt = `SELLER PROFILE:\n${profile.join("\n")}\n\nKNOWLEDGE BASE${truncated ? " (partial; lower confidence if needed facts may be missing)" : ""}:\n${knowledge || "(none provided — do not invent product facts)"}\n\nPROSPECT CONTEXT:\nName: ${conversation.lead_name ?? "unknown"}\nCompany: ${conversation.company ?? "unknown"}\nSubject: ${conversation.subject ?? "(none)"}\n\nTHREAD:\n${thread}\n\n${flagged.length ? `SYSTEM FLAG: Handoff trigger(s) matched: ${flagged.join(", ")}. A human handoff is required.` : ""}\n\nWrite the reply now as JSON.`;

  const content = await chatCompletion({
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: SDR_REPLY_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
  });

  const parsed = parseReply(content);
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    throw new Error("AI returned an unreadable reply");
  }

  let confidence = Number(parsed.confidence);
  confidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : 50;
  const needsHandoff = parsed.needs_handoff === true || flagged.length > 0;
  if (needsHandoff) confidence = Math.min(confidence, 40);
  const reply = parsed.reply.slice(0, 20000);
  const from = conversation.email_accounts?.email_address;
  if (!from) throw new Error("The assigned sending mailbox is unavailable");
  const subject = conversation.subject
    ? conversation.subject.toLowerCase().startsWith("re:")
      ? conversation.subject
      : `Re: ${conversation.subject}`
    : "Re:";

  const { data: draft, error: draftError } = await supabase
    .from("sdr_messages")
    .insert({
      conversation_id: conversation.id,
      user_id: conversation.user_id,
      direction: "outbound",
      from_email: from,
      to_emails: [conversation.lead_email],
      subject,
      body_text: reply,
      snippet: reply.slice(0, 200),
      ai_generated: true,
      agent_id: agent.id,
      status: "draft",
      raw: {
        confidence,
        needs_handoff: needsHandoff,
        handoff_reason: parsed.handoff_reason ?? "",
        auto_reply_job_id: job.id,
      },
    })
    .select("id")
    .single();
  if (draftError) throw new Error(draftError.message);

  await supabase.from("sdr_reply_jobs").update({ draft_message_id: draft.id }).eq("id", job.id);

  const canAutoSend =
    agent.mode === "auto" &&
    !needsHandoff &&
    confidence >= Number(agent.confidence_threshold ?? 80);
  if (!canAutoSend) {
    await Promise.all([
      supabase.from("sdr_messages").update({ status: "draft" }).eq("id", draft.id),
      supabase
        .from("sdr_conversations")
        .update({ status: "needs_approval" })
        .eq("id", conversation.id),
      supabase
        .from("sdr_reply_jobs")
        .update({
          status: "needs_approval",
          draft_message_id: draft.id,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id),
    ]);
    await sendPositiveReplyAlert(supabase, {
      job,
      conversation,
      inboundText: String(inbound.body_text ?? ""),
      aiReply: reply,
      from,
    });
    return { status: "needs_approval" as const };
  }

  const { data: connection } = await supabase
    .from("instantly_connections")
    .select("api_key")
    .eq("user_id", conversation.user_id)
    .maybeSingle();
  if (!connection?.api_key) {
    await Promise.all([
      supabase
        .from("sdr_conversations")
        .update({ status: "needs_approval" })
        .eq("id", conversation.id),
      supabase
        .from("sdr_reply_jobs")
        .update({
          status: "needs_approval",
          error: "Instantly is not connected",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id),
    ]);
    return { status: "needs_approval" as const };
  }

  let replyToUuid = extractInstantlyUuid(inbound.raw);
  if (!replyToUuid) {
    const emails = await instantlyListEmails(connection.api_key, from);
    const lead = conversation.lead_email.toLowerCase();
    const match = emails.find((email: any) =>
      [email?.from_address_email, email?.from, email?.lead_email, email?.from_email]
        .filter(Boolean)
        .some((value: string) => String(value).toLowerCase() === lead),
    );
    replyToUuid = typeof match?.id === "string" ? match.id : null;
  }
  if (!replyToUuid) {
    await Promise.all([
      supabase
        .from("sdr_conversations")
        .update({ status: "needs_approval" })
        .eq("id", conversation.id),
      supabase
        .from("sdr_reply_jobs")
        .update({
          status: "needs_approval",
          error: "Original Instantly email could not be found for threading",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id),
    ]);
    return { status: "needs_approval" as const };
  }

  try {
    await instantlySendReply({
      apiKey: connection.api_key,
      eaccount: from,
      replyToUuid,
      subject,
      text: reply,
    });
  } catch (error) {
    await Promise.all([
      supabase
        .from("sdr_conversations")
        .update({ status: "needs_approval" })
        .eq("id", conversation.id),
      supabase
        .from("sdr_reply_jobs")
        .update({
          status: "needs_approval",
          error: String((error as Error).message ?? error).slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id),
    ]);
    return { status: "needs_approval" as const };
  }
  const completedAt = new Date().toISOString();
  await Promise.all([
    supabase
      .from("sdr_messages")
      .update({ status: "sent", sent_at: completedAt })
      .eq("id", draft.id),
    supabase
      .from("sdr_conversations")
      .update({ status: "open", last_direction: "outbound", last_message_at: completedAt })
      .eq("id", conversation.id),
    supabase
      .from("sdr_reply_jobs")
      .update({ status: "completed", draft_message_id: draft.id, completed_at: completedAt })
      .eq("id", job.id),
  ]);
  await sendPositiveReplyAlert(supabase, {
    job,
    conversation,
    inboundText: String(inbound.body_text ?? ""),
    aiReply: reply,
    from,
  });
  return { status: "completed" as const };
}

async function sendPositiveReplyAlert(
  supabase: AdminClient,
  opts: {
    job: Record<string, any>;
    conversation: Record<string, any>;
    inboundText: string;
    aiReply: string;
    from: string;
  },
) {
  if (
    !opts.conversation.list_id ||
    !["interested", "meeting_booked"].includes(String(opts.conversation.intent))
  )
    return;
  if (opts.job.positive_alert_sent_at) return;

  const [{ data: list }, { data: profile }, { data: connection }] = await Promise.all([
    supabase
      .from("lists")
      .select("name, positive_reply_alerts_enabled, positive_reply_alert_email")
      .eq("id", opts.conversation.list_id)
      .eq("user_id", opts.conversation.user_id)
      .maybeSingle(),
    supabase.from("profiles").select("email").eq("id", opts.conversation.user_id).maybeSingle(),
    supabase
      .from("instantly_connections")
      .select("api_key")
      .eq("user_id", opts.conversation.user_id)
      .maybeSingle(),
  ]);
  if (!list?.positive_reply_alerts_enabled || !connection?.api_key) return;
  const recipient = String(list.positive_reply_alert_email || profile?.email || "").trim();
  if (!recipient) return;

  const prospect = opts.conversation.lead_name || opts.conversation.lead_email;
  const subject = `Positive reply from ${prospect}${opts.conversation.company ? ` at ${opts.conversation.company}` : ""}`;
  const text = [
    `Campaign: ${list.name}`,
    `Prospect: ${prospect} <${opts.conversation.lead_email}>`,
    `Intent: ${String(opts.conversation.intent).replace(/_/g, " ")}`,
    "",
    "PROSPECT REPLIED:",
    opts.inboundText,
    "",
    "AI SDR REPLY:",
    opts.aiReply,
  ]
    .join("\n")
    .slice(0, 45000);

  const response = await fetch("https://api.instantly.ai/api/v2/emails/test", {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      eaccount: opts.from,
      to_address_email_list: recipient,
      subject,
      body: {
        text,
        html: `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(text)}</pre>`,
      },
    }),
  });
  if (!response.ok) {
    console.error(
      "Positive reply alert failed",
      response.status,
      (await response.text()).slice(0, 300),
    );
    return;
  }
  await supabase
    .from("sdr_reply_jobs")
    .update({ positive_alert_sent_at: new Date().toISOString() })
    .eq("id", opts.job.id);
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char,
  );
}
