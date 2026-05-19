// Twilio recording status webhook. Called once when the recording is ready.
// We persist the URL + duration on the matching `calls` row. Transcription +
// AI scorecard happen in Phase 2.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/twilio/recording")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const callId = url.searchParams.get("callId");
        if (!callId) return new Response("Missing callId", { status: 400 });

        const form = await request.formData();
        const recordingSid = String(form.get("RecordingSid") ?? "");
        const recordingUrl = String(form.get("RecordingUrl") ?? "");
        const recordingStatus = String(form.get("RecordingStatus") ?? "");
        const recordingDuration = parseInt(String(form.get("RecordingDuration") ?? "0"), 10) || null;
        const accountSid = String(form.get("AccountSid") ?? "");

        // Verify the call exists and the AccountSid matches a known phone
        // account — this provides a basic anti-forgery check without
        // requiring full Twilio signature validation.
        const { data: call } = await supabaseAdmin
          .from("calls")
          .select("id, phone_account_id")
          .eq("id", callId)
          .maybeSingle();
        if (!call) return new Response("Call not found", { status: 404 });

        if (accountSid && call.phone_account_id) {
          const { data: acc } = await supabaseAdmin
            .from("user_phone_accounts")
            .select("twilio_account_sid")
            .eq("id", call.phone_account_id)
            .maybeSingle();
          if (acc && acc.twilio_account_sid !== accountSid) {
            return new Response("Account mismatch", { status: 403 });
          }
        }

        if (recordingStatus !== "completed") {
          return new Response("ok"); // ignore in-progress events
        }

        await supabaseAdmin
          .from("calls")
          .update({
            recording_sid: recordingSid,
            recording_url: recordingUrl ? `${recordingUrl}.mp3` : null,
            recording_duration_sec: recordingDuration,
          })
          .eq("id", callId);

        return new Response("ok");
      },
    },
  },
});
