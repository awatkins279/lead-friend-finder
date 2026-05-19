import { useState } from "react";
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

export function PhoneAccountDialog({
  userId,
  open,
  onOpenChange,
  onSaved,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("My Twilio");
  const [fromNumber, setFromNumber] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [twimlAppSid, setTwimlAppSid] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!fromNumber.startsWith("+")) return toast.error("From number must be in E.164 format (e.g. +15551234567)");
    if (!accountSid.startsWith("AC")) return toast.error("Account SID should start with AC");
    if (!apiKeySid.startsWith("SK")) return toast.error("API Key SID should start with SK");
    if (!twimlAppSid.startsWith("AP")) return toast.error("TwiML App SID should start with AP");
    setSaving(true);
    const { error } = await supabase.from("user_phone_accounts").insert({
      user_id: userId,
      label,
      from_number: fromNumber,
      twilio_account_sid: accountSid,
      twilio_auth_token: authToken,
      twilio_api_key_sid: apiKeySid,
      twilio_api_key_secret: apiKeySecret,
      twilio_twiml_app_sid: twimlAppSid,
      is_default: true,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Phone account added");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" /> Connect Twilio
          </DialogTitle>
          <DialogDescription>
            Each rep connects their own Twilio sub-account. We never expose your secret to the browser — calls go through short-lived access tokens.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-semibold">Need help?</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li>Sign up at <a className="underline" href="https://twilio.com" target="_blank" rel="noreferrer">twilio.com</a> &amp; buy a phone number</li>
              <li>Twilio Console → Account → API keys &amp; tokens → create a Standard API key (save SID + Secret)</li>
              <li>Voice → TwiML Apps → create one. Voice Request URL: <code className="rounded bg-background px-1 py-0.5">{typeof window !== "undefined" ? `${window.location.origin}/api/public/twilio/voice` : "/api/public/twilio/voice"}</code> (POST)</li>
              <li>Copy the TwiML App SID + your Account SID + Auth Token below</li>
            </ol>
          </div>

          <Two>
            <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field label="From number (E.164)"><Input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+15551234567" /></Field>
          </Two>
          <Two>
            <Field label="Account SID (AC…)"><Input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxx" /></Field>
            <Field label="Auth Token"><Input value={authToken} onChange={(e) => setAuthToken(e.target.value)} type="password" /></Field>
          </Two>
          <Two>
            <Field label="API Key SID (SK…)"><Input value={apiKeySid} onChange={(e) => setApiKeySid(e.target.value)} placeholder="SKxxxxxxxx" /></Field>
            <Field label="API Key Secret"><Input value={apiKeySecret} onChange={(e) => setApiKeySecret(e.target.value)} type="password" /></Field>
          </Two>
          <Field label="TwiML App SID (AP…)">
            <Input value={twimlAppSid} onChange={(e) => setTwimlAppSid(e.target.value)} placeholder="APxxxxxxxx" />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
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
