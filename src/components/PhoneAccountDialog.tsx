import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Phone } from "lucide-react";
import { toast } from "sonner";

export type PhoneAccountRow = {
  id: string;
  label: string;
  from_number: string;
  twilio_account_sid: string;
  twilio_auth_token: string;
  twilio_api_key_sid: string;
  twilio_api_key_secret: string;
  twilio_twiml_app_sid: string | null;
  is_default: boolean;
};

export function PhoneAccountDialog({
  userId,
  open,
  onOpenChange,
  onSaved,
  existing,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  existing?: PhoneAccountRow | null;
}) {
  const [label, setLabel] = useState("My Twilio");
  const [fromNumber, setFromNumber] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [twimlAppSid, setTwimlAppSid] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setLabel(existing.label ?? "My Twilio");
      setFromNumber(existing.from_number ?? "");
      setAccountSid(existing.twilio_account_sid ?? "");
      setAuthToken(existing.twilio_auth_token ?? "");
      setApiKeySid(existing.twilio_api_key_sid ?? "");
      setApiKeySecret(existing.twilio_api_key_secret ?? "");
      setTwimlAppSid(existing.twilio_twiml_app_sid ?? "");
    } else {
      setLabel("My Twilio");
      setFromNumber("");
      setAccountSid("");
      setAuthToken("");
      setApiKeySid("");
      setApiKeySecret("");
      setTwimlAppSid("");
    }
  }, [open, existing]);

  const save = async () => {
    if (fromNumber && !fromNumber.startsWith("+"))
      return toast.error("From number must be in E.164 format (e.g. +15551234567)");
    if (!accountSid.startsWith("AC")) return toast.error("Account SID should start with AC");
    if (!apiKeySid.startsWith("SK")) return toast.error("API Key SID should start with SK");
    if (twimlAppSid && !twimlAppSid.startsWith("AP"))
      return toast.error("TwiML App SID should start with AP");
    setSaving(true);

    const payload = {
      label,
      // Empty placeholder so the NOT NULL column accepts the row until the
      // user buys a real Twilio number and edits this account.
      from_number: fromNumber || "+10000000000",
      twilio_account_sid: accountSid,
      twilio_auth_token: authToken,
      twilio_api_key_sid: apiKeySid,
      twilio_api_key_secret: apiKeySecret,
      twilio_twiml_app_sid: twimlAppSid || null,
    };

    const { error } = existing
      ? await supabase.from("user_phone_accounts").update(payload).eq("id", existing.id)
      : await supabase
          .from("user_phone_accounts")
          .insert({ ...payload, user_id: userId, is_default: true });

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Phone account updated" : "Phone account added");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />{" "}
            {existing ? "Edit phone account" : "Connect Twilio"}
          </DialogTitle>
          <DialogDescription>
            Save your Twilio credentials now. You can leave the From number empty and add it later
            once your account is verified and you've bought a phone number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-semibold">Need help?</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li>
                Sign up at{" "}
                <a className="underline" href="https://twilio.com" target="_blank" rel="noreferrer">
                  twilio.com
                </a>
              </li>
              <li>
                Account → API keys &amp; tokens → create a Standard API key (save SID + Secret)
              </li>
              <li>
                Voice → TwiML Apps → create one. Voice Request URL:{" "}
                <code className="rounded bg-background px-1 py-0.5">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/api/public/twilio/voice`
                    : "/api/public/twilio/voice"}
                </code>{" "}
                (POST)
              </li>
              <li>
                Once verified, Phone Numbers → Buy a number (Voice enabled) and come back to add it
              </li>
            </ol>
          </div>

          <Two>
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="From number (E.164) — optional for now">
              <Input
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+15551234567"
              />
            </Field>
          </Two>
          <Two>
            <Field label="Account SID (AC…)">
              <Input
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxx"
              />
            </Field>
            <Field label="Auth Token">
              <Input
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                type="password"
              />
            </Field>
          </Two>
          <Two>
            <Field label="API Key SID (SK…)">
              <Input
                value={apiKeySid}
                onChange={(e) => setApiKeySid(e.target.value)}
                placeholder="SKxxxxxxxx"
              />
            </Field>
            <Field label="API Key Secret">
              <Input
                value={apiKeySecret}
                onChange={(e) => setApiKeySecret(e.target.value)}
                type="password"
              />
            </Field>
          </Two>
          <Field label="TwiML App SID (AP…) — optional for now">
            <Input
              value={twimlAppSid}
              onChange={(e) => setTwimlAppSid(e.target.value)}
              placeholder="APxxxxxxxx"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
