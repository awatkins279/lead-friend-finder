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

        if (!to) {
          return xml(`<Response><Say>Missing destination number.</Say></Response>`, 400);
        }

        // Look up internal call row if callId provided
        let fromNumber = "";
        let recordingCallback = "";
        let statusCallback = "";

        if (callId) {
          const { data: call } = await supabaseAdmin
            .from("calls")
            .select("id, user_id, list_id, from_number, phone_account_id")
            .eq("id", callId)
            .maybeSingle();

          if (call) {
            fromNumber = (call as any).from_number ?? "";
            if (twilioCallSid) {
              await supabaseAdmin
                .from("calls")
                .update({ twilio_call_sid: twilioCallSid, status: "in_progress" })
                .eq("id", callId);
            }

            // Recording config
            const { data: cfg } = await supabaseAdmin
              .from("list_call_configs")
              .select("record_calls")
              .eq("list_id", (call as any).list_id)
              .maybeSingle();

            const origin = new URL(request.url).origin;
            recordingCallback = `${origin}/api/public/twilio/recording?callId=${encodeURIComponent(callId)}`;
            statusCallback = `${origin}/api/public/twilio/status?callId=${encodeURIComponent(callId)}`;

            const shouldRecord = cfg?.record_calls !== false;
            const recordAttr = shouldRecord
              ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeAttr(recordingCallback)}" recordingStatusCallbackEvent="completed"`
              : "";

            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeAttr(fromNumber)}" answerOnBridge="true" timeout="30" action="${escapeAttr(statusCallback)}"${recordAttr}>
    <Number>${escapeText(to)}</Number>
  </Dial>
</Response>`;
            return xml(twiml);
          }
        }

        // Fallback: no callId or call not found — just connect the call
        const origin = new URL(request.url).origin;
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeout="30">
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
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
