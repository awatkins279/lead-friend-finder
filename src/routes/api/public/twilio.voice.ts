// Twilio TwiML endpoint — called by Twilio when the browser SDK initiates an
// outbound call. We return TwiML telling Twilio to dial the prospect's number,
// record the call, and POST the recording URL back to us when finished.
//
// Twilio sends this request with form-encoded params, NOT JSON.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/twilio/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const to = String(form.get("To") ?? "");
        const callId = String(form.get("callId") ?? "");
        const twilioCallSid = String(form.get("CallSid") ?? "");

        if (!to || !callId) {
          return xml(`<Response><Say>Missing destination number.</Say></Response>`, 400);
        }

        // Look up our internal call row + the user's phone account / config
        const { data: call } = await supabaseAdmin
          .from("calls")
          .select("id, user_id, list_id, from_number, phone_account_id")
          .eq("id", callId)
          .maybeSingle();

        if (!call) {
          return xml(`<Response><Say>Call session not found.</Say></Response>`, 404);
        }

        // Persist the Twilio CallSid so the recording webhook can find this row
        if (twilioCallSid) {
          await supabaseAdmin
            .from("calls")
            .update({ twilio_call_sid: twilioCallSid, status: "in_progress" })
            .eq("id", callId);
        }

        // Recording config from the list
        const { data: cfg } = await supabaseAdmin
          .from("list_call_configs")
          .select("record_calls")
          .eq("list_id", call.list_id)
          .maybeSingle();

        const shouldRecord = cfg?.record_calls !== false;
        const origin = new URL(request.url).origin;
        const recordingCallback = `${origin}/api/public/twilio/recording?callId=${encodeURIComponent(callId)}`;
        const statusCallback = `${origin}/api/public/twilio/status?callId=${encodeURIComponent(callId)}`;

        const recordAttr = shouldRecord ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeAttr(recordingCallback)}" recordingStatusCallbackEvent="completed"` : "";

        // <Dial callerId> must be a Twilio-verified number. Use the rep's from_number.
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeAttr(call.from_number ?? "")}" answerOnBridge="true" timeout="30" action="${escapeAttr(statusCallback)}"${recordAttr}>
    <Number>${escapeText(to)}</Number>
  </Dial>
</Response>`;

        return xml(twiml);
      },
    },
  },
});

function xml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeAttr(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!),
  );
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
