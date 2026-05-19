// Twilio dial status callback — fired when the dialed leg ends. We use the
// final DialCallStatus to set call outcome/duration when the rep doesn't
// explicitly hang up via the UI.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/twilio/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const callId = url.searchParams.get("callId");
        if (!callId) return new Response("Missing callId", { status: 400 });

        const form = await request.formData();
        const status = String(form.get("DialCallStatus") ?? "");
        const duration = parseInt(String(form.get("DialCallDuration") ?? "0"), 10) || null;

        await supabaseAdmin
          .from("calls")
          .update({
            status: status || "completed",
            duration_sec: duration,
            ended_at: new Date().toISOString(),
          })
          .eq("id", callId)
          .is("ended_at", null);

        // Return empty TwiML so Twilio just hangs up
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
          headers: { "Content-Type": "text/xml; charset=utf-8" },
        });
      },
    },
  },
});
