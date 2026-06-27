import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Inbox,
  Sparkles,
} from "lucide-react";
import { SdrAgentDialog } from "@/components/SdrAgentDialog";
import { listSdrAgents, deleteSdrAgent } from "@/lib/sdr.functions";

export const Route = createFileRoute("/app/sdr-agents")({
  component: SdrAgentsPage,
  head: () => ({ meta: [{ title: "AI SDR Agents — NexusAi" }] }),
});

type AgentRow = {
  id: string;
  name: string;
  sdr_display_name: string | null;
  tone: string;
  mode: string;
  response_speed: string;
  inbox_email: string | null;
  inbox_provider: string | null;
  sdr_knowledge_docs: { count: number }[];
  lists: { count: number }[];
};

function SdrAgentsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const list = useServerFn(listSdrAgents);
  const remove = useServerFn(deleteSdrAgent);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    setUserId(u.user?.id ?? null);
    try {
      const r = await list({});
      setAgents(r.agents as AgentRow[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleNew = () => {
    setEditingId(null);
    setOpen(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete agent "${name}"? Any campaigns using it will be unassigned.`)) return;
    try {
      await remove({ data: { id } });
      toast.success("Agent deleted");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const modeLabel = (m: string) =>
    m === "draft" ? "Draft only" : m === "approve" ? "Approve to send" : "Full auto-send";

  const speedLabel = (s: string) =>
    s === "instant"
      ? "Instant"
      : s === "fast"
        ? "5–30 min"
        : s === "medium"
          ? "30 min – 2 hr"
          : "2–8 hr";

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI SDR Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Build a reusable AI rep that replies to inbound emails in your voice. Set it up once,
            then assign it to any campaign to turn it on.
          </p>
        </div>
        <Button onClick={handleNew} disabled={!userId}>
          <Plus className="mr-2 h-4 w-4" /> New SDR agent
        </Button>
      </div>

      {/* Status banner */}
      <Card className="mb-6 flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">AI replies are live · connect Instantly to send</p>
          <p className="mt-1 text-muted-foreground">
            Build agents, upload knowledge, and try them in the <strong>Test</strong> tab now —
            every reply is grounded in your knowledge and saved as a draft for you to approve.
            Connect your Instantly account under <strong>Sending accounts</strong> to import your
            mailboxes; live send &amp; receive is the final step.
          </p>
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : agents.length === 0 ? (
        <Card className="p-12 text-center">
          <Bot className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No SDR agents yet</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            Click <strong>New SDR agent</strong> to build your first reply bot. You'll set its
            voice, what it's selling, response speed, and upload any reference docs it should pull
            from.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => {
            const docCount = a.sdr_knowledge_docs?.[0]?.count ?? 0;
            const campaignCount = a.lists?.[0]?.count ?? 0;
            const inboxConnected = !!a.inbox_email;
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      <span className="font-medium">{a.name}</span>
                      {a.sdr_display_name && (
                        <span className="text-xs text-muted-foreground">
                          → signs as “{a.sdr_display_name}”
                        </span>
                      )}
                      {inboxConnected ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Inbox ready
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Inbox not connected
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="capitalize">{a.tone} tone</span>
                      <span>·</span>
                      <span>{modeLabel(a.mode)}</span>
                      <span>·</span>
                      <span>{speedLabel(a.response_speed)}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" /> {docCount} doc{docCount === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Inbox className="h-3 w-3" /> {campaignCount} campaign
                        {campaignCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(a.id)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(a.id, a.name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {userId && (
        <SdrAgentDialog
          open={open}
          onOpenChange={setOpen}
          agentId={editingId}
          userId={userId}
          onSaved={load}
        />
      )}
    </div>
  );
}
