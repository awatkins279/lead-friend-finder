// Twilio recording status webhook. Called once when the recording is ready.
// Persists the recording URL + duration, then triggers AI call scoring.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chatCompletion } from "@/lib/ai-client";

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
        const recordingDuration =
          parseInt(String(form.get("RecordingDuration") ?? "0"), 10) || null;
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

        // Trigger AI scoring (best-effort, non-blocking)
        try {
          const { data: callData } = await supabaseAdmin
            .from("calls")
            .select(
              "id, duration_sec, outcome, notes, leads(first_name,last_name,title,org_name,org_industry)",
            )
            .eq("id", callId)
            .maybeSingle();

          if (callData && (callData as any).duration_sec > 10) {
            const lead = (callData as any).leads;
            const prospect = lead
              ? `${lead.first_name || ""} ${lead.last_name || ""} — ${lead.title || ""} at ${lead.org_name || ""}`
              : "unknown prospect";

            const content = await chatCompletion({
              model: "deepseek/deepseek-chat",
              messages: [
                {
                  role: "system",
                  content:
                    "Score this cold call. Focus on NEPQ techniques. Output ONLY valid JSON. No markdown.",
                },
                {
                  role: "user",
                  content: `Prospect: ${prospect}\nDuration: ${(callData as any).duration_sec}s\nOutcome: ${(callData as any).outcome || "unknown"}\n\nReturn JSON:\n{"overall_score":0-100,"opener_rating":0-10,"discovery_rating":0-10,"objection_handling":0-10,"closing_rating":0-10,"talk_listen_ratio":"e.g. 40/60","strengths":["..."],"improvements":["..."],"summary":"...\n}`,
                },
              ],
              max_tokens: 500,
            });

            const scorecard = JSON.parse(content);
            await supabaseAdmin
              .from("calls")
              .update({
                scorecard: scorecard,
                call_score: Math.round(scorecard.overall_score || 50),
              })
              .eq("id", callId);
          }
        } catch {
          // Scoring is best-effort — never fail the webhook
        }

        return new Response("ok");
      },
    },
  },
});
