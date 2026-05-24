import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Normalized inbound-email payload. Whichever provider (Gmail webhook,
// Outlook Graph subscription, IMAP poller) the user wires up later, the
// adapter just needs to translate into this shape.
const payloadSchema = z.object({
  secret: z.string().min(10), // shared secret per webhook
  to_email: z.string().email(),
  from_email: z.string().email(),
  from_name: z.string().max(200).optional(),
  subject: z.string().max(500).optional(),
  body_text: z.string().max(200000).optional(),
  body_html: z.string().max(500000).optional(),
  message_id: z.string().max(500).optional(),
  in_reply_to: z.string().max(500).optional(),
  email_references: z.array(z.string()).max(100).optional(),
  received_at: z.string().optional(),
});

export const Route = createFileRoute("/api/public/inbox/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.INBOX_INGEST_SECRET;
        if (!secret) {
          return new Response("Not configured", { status: 503 });
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) {
          return new Response("Invalid payload", { status: 400 });
        }
        if (parsed.data.secret !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const p = parsed.data;

        // Resolve which email account this landed on.
        const { data: account } = await supabaseAdmin
          .from("email_accounts")
          .select("id, user_id")
          .eq("email_address", p.to_email)
          .maybeSingle();
        if (!account) {
          return new Response("Inbox not registered", { status: 404 });
        }

        // Find existing conversation by thread headers, else create.
        let conversationId: string | null = null;
        if (p.in_reply_to) {
          const { data: prior } = await supabaseAdmin
            .from("sdr_messages")
            .select("conversation_id")
            .eq("message_id", p.in_reply_to)
            .maybeSingle();
          if (prior?.conversation_id) conversationId = prior.conversation_id as string;
        }
        if (!conversationId) {
          const { data: convo, error: cErr } = await supabaseAdmin
            .from("sdr_conversations")
            .insert({
              user_id: account.user_id,
              email_account_id: account.id,
              lead_email: p.from_email,
              lead_name: p.from_name ?? null,
              subject: p.subject ?? null,
              last_message_at: p.received_at ?? new Date().toISOString(),
              last_direction: "inbound",
              unread_count: 1,
              status: "open",
            })
            .select("id")
            .single();
          if (cErr) return new Response(cErr.message, { status: 500 });
          conversationId = convo.id as string;
        } else {
          await supabaseAdmin
            .from("sdr_conversations")
            .update({
              last_message_at: p.received_at ?? new Date().toISOString(),
              last_direction: "inbound",
              status: "open",
            })
            .eq("id", conversationId);
        }


        const { error: mErr } = await supabaseAdmin.from("sdr_messages").insert({
          conversation_id: conversationId,
          user_id: account.user_id,
          direction: "inbound",
          from_email: p.from_email,
          from_name: p.from_name ?? null,
          to_emails: [p.to_email],
          subject: p.subject ?? null,
          body_text: p.body_text ?? null,
          body_html: p.body_html ?? null,
          snippet: (p.body_text ?? "").slice(0, 200),
          message_id: p.message_id ?? null,
          in_reply_to: p.in_reply_to ?? null,
          email_references: p.email_references ?? [],
          received_at: p.received_at ?? new Date().toISOString(),
          status: "received",
        });
        if (mErr) return new Response(mErr.message, { status: 500 });

        return Response.json({ ok: true, conversation_id: conversationId });
      },
    },
  },
});
