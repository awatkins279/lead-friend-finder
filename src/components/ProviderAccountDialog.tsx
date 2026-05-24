import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Phone, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import type { PhoneAccountRow } from "@/components/PhoneAccountDialog";

export type ProviderField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  required?: boolean;
  helper?: string;
  multiline?: boolean;
};

export type ProviderSpec = {
  id: string;
  name: string;
  /** Optional setup instructions shown at the top of the dialog. */
  instructions?: React.ReactNode;
  /** Provider-specific credential fields stored in credentials jsonb. */
  fields: ProviderField[];
};

export function ProviderAccountDialog({
  userId,
  provider,
  open,
  onOpenChange,
  onSaved,
  existing,
}: {
  userId: string;
  provider: ProviderSpec;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  existing?: PhoneAccountRow | null;
}) {
  const [label, setLabel] = useState(`My ${provider.name}`);
  const [fromNumber, setFromNumber] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setLabel(existing.label ?? `My ${provider.name}`);
      setFromNumber(existing.from_number ?? "");
      const creds = ((existing as unknown as { credentials?: Record<string, string> }).credentials) ?? {};
      setValues(creds);
    } else {
      setLabel(`My ${provider.name}`);
      setFromNumber("");
      setValues({});
    }
    setShown({});
  }, [open, existing, provider.name]);

  const save = async () => {
    if (fromNumber && !fromNumber.startsWith("+")) {
      return toast.error("From number must be E.164 (e.g. +15551234567)");
    }
    for (const f of provider.fields) {
      if (f.required && !values[f.key]?.trim()) {
        return toast.error(`${f.label} is required`);
      }
    }
    setSaving(true);

    const payload = {
      label,
      provider: provider.id,
      from_number: fromNumber || null,
      credentials: values as Record<string, string>,
    };

    const { error } = existing
      ? await supabase.from("user_phone_accounts").update(payload).eq("id", existing.id)
      : await supabase
          .from("user_phone_accounts")
          .insert({ ...payload, user_id: userId, is_default: false });

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Account updated" : `${provider.name} connected`);
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            {existing ? `Edit ${provider.name}` : `Connect ${provider.name}`}
          </DialogTitle>
          <DialogDescription>
            Enter your {provider.name} API credentials. They're stored securely and used to place calls from your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {provider.instructions && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">{provider.instructions}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="From number (E.164) — optional">
              <Input
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+15551234567"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {provider.fields.map((f) => {
              const isPassword = f.type === "password";
              const isShown = !!shown[f.key];
              const value = values[f.key] ?? "";
              const setValue = (v: string) =>
                setValues((prev) => ({ ...prev, [f.key]: v }));

              return (
                <Field
                  key={f.key}
                  label={`${f.label}${f.required ? "" : " (optional)"}`}
                  helper={f.helper}
                  actions={
                    <div className="flex items-center gap-1">
                      {isPassword && (
                        <button
                          type="button"
                          onClick={() => setShown((s) => ({ ...s, [f.key]: !s[f.key] }))}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {isShown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {isShown ? "Hide" : "Show"}
                        </button>
                      )}
                      {value && (
                        <button
                          type="button"
                          onClick={() => setValue("")}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  }
                >
                  {f.multiline ? (
                    <Textarea
                      rows={5}
                      value={value}
                      placeholder={f.placeholder}
                      onChange={(e) => setValue(e.target.value)}
                      className={`font-mono text-xs ${
                        isPassword && !isShown ? "[-webkit-text-security:disc] [text-security:disc]" : ""
                      } break-all`}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  ) : (
                    <Input
                      type={isPassword && !isShown ? "password" : "text"}
                      value={value}
                      placeholder={f.placeholder}
                      onChange={(e) => setValue(e.target.value)}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  helper,
  actions,
  children,
}: {
  label: string;
  helper?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {actions}
      </div>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

/* ------------------------------ Provider specs ------------------------------ */

export const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  ringcentral: {
    id: "ringcentral",
    name: "RingCentral",
    instructions: (
      <>
        <p className="font-semibold">How to connect</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
          <li>Go to <a className="underline" href="https://developers.ringcentral.com" target="_blank" rel="noreferrer">developers.ringcentral.com</a> → Console → Apps</li>
          <li>Create a <em>REST API App</em> → platform <em>Browser-Based / SPA</em>, auth <em>3-legged OAuth</em></li>
          <li>Add scope <code>VoIP Calling</code> (plus <code>Read Accounts</code>, <code>Read Call Log</code>)</li>
          <li>Set OAuth redirect URI to <code>https://lead-friend-finder.lovable.app/api/ringcentral/oauth/callback</code></li>
          <li>Paste the <em>Client ID</em> + <em>Client Secret</em> below, click Save, then click <strong>Sign in with RingCentral</strong>.</li>
        </ol>
      </>
    ),
    fields: [
      { key: "server_url", label: "Server URL", placeholder: "https://platform.ringcentral.com", required: true, helper: "Use platform.ringcentral.com for production, platform.devtest.ringcentral.com for sandbox." },
      { key: "client_id", label: "Client ID", required: true },
      { key: "client_secret", label: "Client Secret", type: "password", required: true },
    ],
  },
  vonage: {
    id: "vonage",
    name: "Vonage",
    fields: [
      { key: "application_id", label: "Application ID", required: true },
      { key: "private_key", label: "Private key (PEM)", type: "password", required: true, multiline: true, helper: "Paste the full PEM block including the BEGIN/END lines." },
      { key: "api_key", label: "API key", required: true },
      { key: "api_secret", label: "API secret", type: "password", required: true },
    ],
  },
  plivo: {
    id: "plivo",
    name: "Plivo",
    fields: [
      { key: "auth_id", label: "Auth ID", required: true },
      { key: "auth_token", label: "Auth token", type: "password", required: true },
    ],
  },
  telnyx: {
    id: "telnyx",
    name: "Telnyx",
    fields: [
      { key: "api_key", label: "API key", type: "password", required: true },
      { key: "connection_id", label: "Voice connection ID", required: true },
    ],
  },
  bandwidth: {
    id: "bandwidth",
    name: "Bandwidth",
    fields: [
      { key: "account_id", label: "Account ID", required: true },
      { key: "username", label: "API username", required: true },
      { key: "password", label: "API password", type: "password", required: true },
      { key: "application_id", label: "Voice application ID", required: true },
    ],
  },
};
