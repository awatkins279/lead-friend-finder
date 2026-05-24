import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export type EmailAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  email_address: string;
  display_name: string | null;
  status: string;
  auth_method: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  imap_host: string | null;
  imap_port: number | null;
  notes: string | null;
};

const PROVIDERS = [
  { id: "gmail", name: "Gmail / Google Workspace" },
  { id: "outlook", name: "Outlook / Microsoft 365" },
  { id: "smtp", name: "Custom SMTP/IMAP" },
  { id: "manual", name: "Other (placeholder)" },
];

export function EmailAccountDialog({
  userId,
  open,
  onOpenChange,
  onSaved,
  existing,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  existing: EmailAccountRow | null;
}) {
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("gmail");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState<string>("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setProvider(existing.provider);
      setEmail(existing.email_address);
      setDisplayName(existing.display_name ?? "");
      setSmtpHost(existing.smtp_host ?? "");
      setSmtpPort(existing.smtp_port?.toString() ?? "");
      setImapHost(existing.imap_host ?? "");
      setImapPort(existing.imap_port?.toString() ?? "");
      setNotes(existing.notes ?? "");
    } else {
      setProvider("gmail");
      setEmail("");
      setDisplayName("");
      setSmtpHost("");
      setSmtpPort("");
      setImapHost("");
      setImapPort("");
      setNotes("");
    }
  }, [open, existing]);

  const save = async () => {
    if (!email.trim()) {
      toast.error("Email address is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: userId,
        provider,
        email_address: email.trim().toLowerCase(),
        display_name: displayName.trim() || null,
        status: "pending",
        auth_method: provider === "smtp" ? "smtp" : "oauth_pending",
        smtp_host: smtpHost.trim() || null,
        smtp_port: smtpPort ? parseInt(smtpPort, 10) : null,
        imap_host: imapHost.trim() || null,
        imap_port: imapPort ? parseInt(imapPort, 10) : null,
        notes: notes.trim() || null,
      };
      if (existing) {
        const { error } = await supabase
          .from("email_accounts")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        toast.success("Email account updated");
      } else {
        const { error } = await supabase.from("email_accounts").insert(payload);
        if (error) throw new Error(error.message);
        toast.success("Email account added");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const isSmtp = provider === "smtp";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit email account" : "Add email account"}</DialogTitle>
          <DialogDescription>
            Register the inbox your AI SDR will reply through. Credentials &amp; OAuth get
            connected after this — for now we save the address so you can already assign
            it to an agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Email address</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sarah@acme.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Sarah Chen"
              />
            </div>
          </div>

          {isSmtp && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>SMTP host</Label>
                  <Input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.yourprovider.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>SMTP port</Label>
                  <Input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>IMAP host</Label>
                  <Input
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    placeholder="imap.yourprovider.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>IMAP port</Label>
                  <Input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this inbox (warmup status, vendor, etc.)"
            />
          </div>

          <div className="rounded-md border border-amber-500/30 bg-amber-50/30 p-3 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            Status will stay <strong>Pending</strong> until the OAuth/SMTP credential
            flow is connected. Your AI SDR can already be configured to use this address
            and will start sending automatically the moment credentials are in.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Update" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
