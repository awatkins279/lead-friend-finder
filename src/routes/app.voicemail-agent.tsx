import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VoicemailAgent } from "@/components/VoicemailAgent";

export const Route = createFileRoute("/app/voicemail-agent")({
  component: VoicemailAgentPage,
  head: () => ({ meta: [{ title: "AI Voicemail Agent — NexusAi" }] }),
});

function VoicemailAgentPage() {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Voicemail Agent</h1>
        <p className="text-sm text-muted-foreground">
          Clone your voice once. Then drop personalized AI voicemails from any call.
        </p>
      </div>
      {userId && <VoicemailAgent userId={userId} />}
    </div>
  );
}
