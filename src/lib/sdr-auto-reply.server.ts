import { SDR_REPLY_SYSTEM_PROMPT, buildKnowledgeBlock } from "./sdr-reply-prompt";
import { instantlyListEmails, instantlySendReply } from "./instantly.functions";

type AdminClient = any;

function parseReply(raw: string) {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
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
        .select("id, user_id, lead_email, lead_name, company, subject, email_account_id, email_accounts(email_address)")
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
      .update({ status: "cancelled", completed_at: new Date().toISOString(), error: "Superseded by a newer inbound reply" })
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
    .map((message: any) => `${message.direction === "inbound" ? "PROSPECT" : `US (${sdrName})`}:\n${String(message.body_text ?? "").slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const prompt = `SELLER PROFILE:\n${profile.join("\n")}\n\nKNOWLEDGE BASE${truncated ? " (partial; lower confidence if needed facts may be missing)" : ""}:\n${knowledge || "(none provided — do not invent product facts)"}\n\nPROSPECT CONTEXT:\nName: ${conversation.lead_name ?? "unknown"}\nCompany: ${conversation.company ?? "unknown"}\nSubject: ${conversation.subject ?? "(none)"}\n\nTHREAD:\n${thread}\n\n${flagged.length ? `SYSTEM FLAG: Handoff trigger(s) matched: ${flagged.join(", ")}. A human handoff is required.` : ""}\n\nWrite the reply now as JSON.`;

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SDR_REPLY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    }),
  });
  if (!response.ok) throw new Error(`AI reply generation failed (${response.status})`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const parsed = parseReply(payload.choices?.[0]?.message?.content ?? "");
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    throw new Error("AI returned an unreadable reply");
  }

  let confidence = Number(parsed.confidence);
  confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : 50;
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
      raw: { confidence, needs_handoff: needsHandoff, handoff_reason: parsed.handoff_reason ?? "", auto_reply_job_id: job.id },
    })
    .select("id")
    .single();
  if (draftError) throw new Error(draftError.message);

  const canAutoSend = agent.mode === "auto" && !needsHandoff && confidence >= Number(agent.confidence_threshold ?? 80);
  if (!canAutoSend) {
    await Promise.all([
      supabase.from("sdr_messages").update({ status: "draft" }).eq("id", draft.id),
      supabase.from("sdr_conversations").update({ status: "needs_approval" }).eq("id", conversation.id),
      supabase.from("sdr_reply_jobs").update({ status: "needs_approval", draft_message_id: draft.id, completed_at: new Date().toISOString() }).eq("id", job.id),
    ]);
    return { status: "needs_approval" as const };
  }

  const { data: connection } = await supabase
    .from("instantly_connections")
    .select("api_key")
    .eq("user_id", conversation.user_id)
    .maybeSingle();
  if (!connection?.api_key) throw new Error("Instantly is not connected");

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
  if (!replyToUuid) throw new Error("The original Instantly email could not be found for threading");

  await instantlySendReply({ apiKey: connection.api_key, eaccount: from, replyToUuid, subject, text: reply });
  const completedAt = new Date().toISOString();
  await Promise.all([
    supabase.from("sdr_messages").update({ status: "sent", sent_at: completedAt }).eq("id", draft.id),
    supabase.from("sdr_conversations").update({ status: "open", last_direction: "outbound", last_message_at: completedAt }).eq("id", conversation.id),
    supabase.from("sdr_reply_jobs").update({ status: "completed", draft_message_id: draft.id, completed_at: completedAt }).eq("id", job.id),
  ]);
  return { status: "completed" as const };
}