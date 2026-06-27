import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, RefreshCcw, CheckCircle2, ExternalLink } from "lucide-react";
import {
  connectInstantly,
  getInstantlyStatus,
  syncInstantlyAccounts,
  disconnectInstantly,
} from "@/lib/instantly.functions";

type Status = {
  connected: boolean;
  account_count?: number;
  last_synced_at?: string | null;
};

export function InstantlyConnectCard({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const statusFn = useServerFn(getInstantlyStatus);
  const connectFn = useServerFn(connectInstantly);
  const syncFn = useServerFn(syncInstantlyAccounts);
  const disconnectFn = useServerFn(disconnectInstantly);

  const loadStatus = () => {
    statusFn()
      .then((s) => setStatus(s))
      .catch(() => setStatus({ connected: false }));
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your Instantly API key first");
      return;
    }
    setBusy(true);
    try {
      const r = await connectFn({ data: { api_key: apiKey.trim() } });
      toast.success(
        r.imported > 0
          ? `Connected — imported ${r.imported} mailbox${r.imported === 1 ? "" : "es"}`
          : "Connected. No mailboxes found yet — sync again once your import finishes.",
      );
      setApiKey("");
      setExpanded(false);
      loadStatus();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await syncFn();
      toast.success(`Synced — ${r.imported} mailbox${r.imported === 1 ? "" : "es"} available`);
      loadStatus();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Instantly? Imported mailboxes stay, but won't auto-sync.")) return;
    setBusy(true);
    try {
      await disconnectFn();
      toast.success("Disconnected");
      loadStatus();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected;

  return (
    <Card className="border-primary/20 bg-primary/[0.03] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Instantly</span>
              {connected ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Not connected
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {connected
                ? `${status?.account_count ?? 0} mailbox(es) imported${
                    status?.last_synced_at
                      ? ` · last synced ${new Date(status.last_synced_at).toLocaleString()}`
                      : ""
                  }. Re-sync after Instantly finishes importing your domains.`
                : "Connect your Instantly account to pull in all your domains & mailboxes automatically. Your AI SDR sends replies through them."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <Button size="sm" variant="outline" onClick={sync} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Sync mailboxes
              </Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setExpanded((v) => !v)} disabled={busy}>
              <Zap className="mr-1.5 h-3.5 w-3.5" /> Connect Instantly
            </Button>
          )}
        </div>
      </div>

      {!connected && expanded && (
        <div className="mt-4 space-y-2 border-t pt-4">
          <label className="text-xs font-medium">Instantly API key</label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Instantly API key"
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <Button onClick={connect} disabled={busy || !apiKey.trim()}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Connect
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Find it in Instantly under <strong>Settings → Integrations → API Keys</strong>. It's
            stored securely and only used to import your mailboxes and send replies.{" "}
            <a
              href="https://app.instantly.ai/app/settings/integrations"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline"
            >
              Open Instantly <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      )}
    </Card>
  );
}
