import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyIntent } from "@/lib/intent";

// Instantly Unibox -> app inbox sync.
//
// Instantly POSTs reply events here. We resolve which of the user's mailboxes
// received it (email_account), find/create the conversation, and append the
// inbound message — so prospect replies land in the in-app inbox in real time.
// The full Instantly payload is stored on the message's `raw` column (it holds
// the unibox_url + any ids we'll need to send a reply back through Instantly).
//
// Security: a shared secret passed as ?secret=... (Instantly lets you set the
// webhook URL, so we embed the secret there) or an x-webhook-secret header.

const payloadSchema = z
  .object({
    event_type: z.string().optional(),
    timestamp: z.string().optional(),
    campaign_id: z.string().optional(),
    campaign_name: z.string().optional(),
    lead_email: z.string().email().optional(),
    email_account: z.string().optional(), // the mailbox (ours) that received the reply
    reply_subject: z.string().max(2000).optional(),
    reply_text: z.string().max(500000).optional(),
    reply_html: z.string().max(1000000).optional(),
    reply_text_snippet: z.string().max(2000).optional(),
    unibox_url: z.string().max(2000).optional(),
  })
  .passthrough();

export const Route = createFileRoute("/api/public/instantly/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1) Auth via shared secret.
        const expected = process.env.INSTANTLY_WEBHOOK_SECRET;
        const provided =
          new URL(request.url).searchParams.get("secret") ??
          request.headers.get("x-webhook-secret");
        if (!expected) return new Response("Not configured", { status: 503 });
        if (!provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        // 2) Parse.
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) return new Response("Invalid payload", { status: 400 });
        const p = parsed.data;

        // 3) Only handle reply events; ack everything else so Instantly stops retrying.
        if (p.event_type && !/repl/i.test(p.event_type)) {
          return Response.json({ ok: true, ignored: p.event_type });
        }
        if (!p.lead_email || !p.email_account) {
          return Response.json({ ok: true, ignored: "missing lead_email or email_account" });
        }

        const leadEmail = p.lead_email.toLowerCase();
        const mailbox = p.email_account.toLowerCase();
        const receivedAt = p.timestamp ?? new Date().toISOString();
        const bodyText = p.reply_text ?? null;
        const snippet = (p.reply_text_snippet ?? p.reply_text ?? "").slice(0, 200);

        // 4) Resolve which user/mailbox this landed on.
        const { data: account } = await supabaseAdmin
          .from("email_accounts")
          .select("id, user_id")
          .eq("email_address", mailbox)
          .maybeSingle();
        if (!account) {
          // Mailbox not imported into the app yet — accept but skip.
          return Response.json({ ok: true, ignored: "mailbox not registered" });
        }

        // 5) Find an open conversation for this lead on this mailbox, else create.
        let conversationId: string | null = null;
        let priorUnread = 0;
        const { data: existing } = await supabaseAdmin
          .from("sdr_conversations")
          .select("id, unread_count")
          .eq("user_id", account.user_id)
          .eq("email_account_id", account.id)
          .eq("lead_email", leadEmail)
          .neq("status", "archived")
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          conversationId = existing.id as string;
          priorUnread = (existing as { unread_count: number }).unread_count ?? 0;
        } else {
          const { data: convo, error: cErr } = await supabaseAdmin
            .from("sdr_conversations")
            .insert({
              user_id: account.user_id,
              email_account_id: account.id,
              lead_email: leadEmail,
              subject: p.reply_subject ?? null,
              last_message_at: receivedAt,
              last_direction: "inbound",
              unread_count: 1,
              status: "open",
            })
            .select("id")
            .single();
          if (cErr) return new Response(cErr.message, { status: 500 });
          conversationId = convo.id as string;
        }

        // 6) Append the inbound message (Instantly payload kept in `raw`).
        const { error: mErr } = await supabaseAdmin.from("sdr_messages").insert({
          conversation_id: conversationId,
          user_id: account.user_id,
          direction: "inbound",
          from_email: leadEmail,
          to_emails: [mailbox],
          subject: p.reply_subject ?? null,
          body_text: bodyText,
          body_html: p.reply_html ?? null,
          snippet,
          received_at: receivedAt,
          status: "received",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          raw: p as any,
        });
        if (mErr) return new Response(mErr.message, { status: 500 });

        // 7) Bump the conversation if it already existed.
        if (existing) {
          await supabaseAdmin
            .from("sdr_conversations")
            .update({
              last_message_at: receivedAt,
              last_direction: "inbound",
              unread_count: priorUnread + 1,
              status: "open",
            })
            .eq("id", conversationId);
        }

        // 8) Auto-classify the reply's intent so the inbox sorts itself (best-effort).
        const cls = await classifyIntent({
          text: bodyText ?? snippet,
          subject: p.reply_subject ?? null,
          apiKey: process.env.LOVABLE_API_KEY ?? "",
        });
        if (cls) {
          await supabaseAdmin
            .from("sdr_conversations")
            .update({ intent: cls.intent, intent_confidence: cls.confidence })
            .eq("id", conversationId);
        }

        return Response.json({
          ok: true,
          conversation_id: conversationId,
          intent: cls?.intent ?? null,
        });
      },
    },
  },
});
