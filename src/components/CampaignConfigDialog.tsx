import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

export const DEFAULT_UNSUB_FOOTER =
  "If you'd rather not hear from me, just reply \"unsubscribe\" and I'll take you off my list.";

export type CampaignConfig = {
  name: string;
  description: string | null;
  sender_name: string | null;
  sender_title: string | null;
  sender_company: string | null;
  what_selling: string | null;
  key_selling_points: string | null;
  num_emails: number;
  word_count: number;
  personalization_level: string;
  cta_type: string;
  extra_instructions: string | null;
  sending_days: number[];
  sending_start_time: string;
  sending_end_time: string;
  sending_timezone: string;
  follow_up_delay_days: number;
  email_gap_minutes: number;
  positive_reply_alerts_enabled: boolean;
  positive_reply_alert_email: string | null;
};

const SEND_DAYS = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function CampaignConfigDialog({
  listId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  listId: string;
  initial: CampaignConfig;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<CampaignConfig>(initial);
  const [wordCountInput, setWordCountInput] = useState(String(initial.word_count));
  const [saving, setSaving] = useState(false);

  // Per-campaign mailbox pool.
  const [mailboxes, setMailboxes] = useState<{ id: string; email_address: string }[]>([]);
  const [selectedMailboxes, setSelectedMailboxes] = useState<Set<string>>(new Set());
  const [mailboxSearch, setMailboxSearch] = useState("");

  // Unsubscribe footer (appended to every generated email).
  const [footerEnabled, setFooterEnabled] = useState(true);
  const [footerText, setFooterText] = useState(DEFAULT_UNSUB_FOOTER);

  useEffect(() => {
    if (!open) return;
    setCfg(initial);
    setWordCountInput(String(initial.word_count));
    setMailboxSearch("");
    (async () => {
      const sb = supabase as any;
      const [{ data: accts }, { data: assigned }, { data: listRow }] = await Promise.all([
        supabase
          .from("email_accounts")
          .select("id, email_address")
          .order("email_address", { ascending: true }),
        sb.from("list_email_accounts").select("email_account_id").eq("list_id", listId),
        sb
          .from("lists")
          .select("unsubscribe_footer_enabled, unsubscribe_footer_text")
          .eq("id", listId)
          .maybeSingle(),
      ]);
      setMailboxes((accts ?? []) as { id: string; email_address: string }[]);
      setSelectedMailboxes(
        new Set(((assigned ?? []) as { email_account_id: string }[]).map((r) => r.email_account_id)),
      );
      if (listRow) {
        setFooterEnabled((listRow as any).unsubscribe_footer_enabled ?? true);
        setFooterText((listRow as any).unsubscribe_footer_text || DEFAULT_UNSUB_FOOTER);
      }
    })();
  }, [open, initial, listId]);

  const toggleMailbox = (id: string, on: boolean) =>
    setSelectedMailboxes((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const update = <K extends keyof CampaignConfig>(k: K, v: CampaignConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    if (!cfg.name.trim()) return toast.error("Campaign name required");
    if (!cfg.sender_name?.trim()) return toast.error("Your name required");
    if (!cfg.what_selling?.trim()) return toast.error("What you're selling required");
    if (!cfg.sending_days.length) return toast.error("Choose at least one sending day");
    if (cfg.sending_start_time >= cfg.sending_end_time) return toast.error("Sending end time must be after the start time");
    if (cfg.positive_reply_alerts_enabled && !cfg.positive_reply_alert_email?.trim()) return toast.error("Enter an email for positive reply alerts");
    setSaving(true);
    const { error } = await supabase
      .from("lists")
      .update({
        name: cfg.name.trim(),
        description: cfg.description,
        sender_name: cfg.sender_name,
        sender_title: cfg.sender_title,
        sender_company: cfg.sender_company,
        what_selling: cfg.what_selling,
        key_selling_points: cfg.key_selling_points,
        num_emails: cfg.num_emails,
        word_count: cfg.word_count,
        personalization_level: cfg.personalization_level,
        cta_type: cfg.cta_type,
        extra_instructions: cfg.extra_instructions,
        sending_days: cfg.sending_days,
        sending_start_time: cfg.sending_start_time,
        sending_end_time: cfg.sending_end_time,
        sending_timezone: cfg.sending_timezone,
        follow_up_delay_days: cfg.follow_up_delay_days,
        email_gap_minutes: cfg.email_gap_minutes,
        positive_reply_alerts_enabled: cfg.positive_reply_alerts_enabled,
        positive_reply_alert_email: cfg.positive_reply_alert_email?.trim() || null,
      })
      .eq("id", listId);
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }

    // Sync the campaign's mailbox pool.
    try {
      const sb = supabase as any;
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      await sb.from("list_email_accounts").delete().eq("list_id", listId);
      if (selectedMailboxes.size && uid) {
        const rows = [...selectedMailboxes].map((email_account_id) => ({
          list_id: listId,
          email_account_id,
          user_id: uid,
        }));
        const { error: mErr } = await sb.from("list_email_accounts").insert(rows);
        if (mErr) throw new Error(mErr.message);
      }
    } catch (e) {
      setSaving(false);
      const msg = (e as Error).message;
      if (/list_email_accounts/i.test(msg)) {
        return toast.error(
          "Campaign saved, but mailbox assignment needs its database table (migration not applied yet).",
        );
      }
      return toast.error(msg);
    }

    // Save the unsubscribe footer (best-effort — columns may not exist yet).
    try {
      const sb = supabase as any;
      const { error: fErr } = await sb
        .from("lists")
        .update({
          unsubscribe_footer_enabled: footerEnabled,
          unsubscribe_footer_text: footerText.trim() || null,
        })
        .eq("id", listId);
      if (fErr) throw new Error(fErr.message);
    } catch (e) {
      setSaving(false);
      const msg = (e as Error).message;
      if (/unsubscribe_footer/i.test(msg)) {
        return toast.error(
          "Campaign saved, but the unsubscribe footer needs its database columns (migration not applied yet).",
        );
      }
      return toast.error(msg);
    }

    setSaving(false);
    toast.success("Campaign saved");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Email generator config
          </DialogTitle>
          <DialogDescription>
            Set up your campaign once — every prospect's sequence is generated against this context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Campaign name">
              <Input value={cfg.name} onChange={(e) => update("name", e.target.value)} />
            </Field>
            <Field label="Your name">
              <Input
                value={cfg.sender_name ?? ""}
                onChange={(e) => update("sender_name", e.target.value)}
                placeholder="Jane Smith"
              />
            </Field>
          </div>

          <Field
            label="What you're selling"
            hint="High-level context. The AI uses this as the north star but takes creative control over angle, hook, and copy."
          >
            <Textarea
              rows={3}
              value={cfg.what_selling ?? ""}
              onChange={(e) => update("what_selling", e.target.value)}
              placeholder="AI-powered contact center solutions that cut operating costs by up to 50%…"
            />
          </Field>

          <Field label="Key selling points / ICP notes (optional)">
            <Textarea
              rows={3}
              value={cfg.key_selling_points ?? ""}
              onChange={(e) => update("key_selling_points", e.target.value)}
              placeholder="Any mid-market to enterprise company with 200-5000+ employees that…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Emails in sequence">
              <Select
                value={String(cfg.num_emails)}
                onValueChange={(v) => update("num_emails", parseInt(v))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} email{n > 1 ? "s" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Target word count per email">
              <Input
                type="number"
                value={wordCountInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setWordCountInput(value);
                  if (value !== "") update("word_count", parseInt(value, 10));
                }}
                onBlur={() => {
                  if (wordCountInput === "") setWordCountInput(String(cfg.word_count));
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Personalization level">
              <Select
                value={cfg.personalization_level}
                onValueChange={(v) => update("personalization_level", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — mostly merge fields</SelectItem>
                  <SelectItem value="medium">Medium — role + industry refs</SelectItem>
                  <SelectItem value="high">High — hand-written feel</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="CTA type" hint="AI picks the best CTA per email when set to Auto.">
              <Select value={cfg.cta_type} onValueChange={(v) => update("cta_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Let AI choose per email</SelectItem>
                  <SelectItem value="meeting">Always ask for meeting</SelectItem>
                  <SelectItem value="reply">Always ask for reply</SelectItem>
                  <SelectItem value="resource">Always offer a resource</SelectItem>
                  <SelectItem value="question">Always end with a question</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Your title">
              <Input
                value={cfg.sender_title ?? ""}
                onChange={(e) => update("sender_title", e.target.value)}
                placeholder="President"
              />
            </Field>
            <Field label="Your company">
              <Input
                value={cfg.sender_company ?? ""}
                onChange={(e) => update("sender_company", e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Extra instructions to the AI (optional)"
            hint="Free-form. Voice samples, things to avoid, specific angles, etc. Layered ON TOP of prospect intel."
          >
            <Textarea
              rows={4}
              value={cfg.extra_instructions ?? ""}
              onChange={(e) => update("extra_instructions", e.target.value)}
              placeholder="Friendly, conversational tone. First email CTA should be like: 'if you could save 50% on your call center costs…'"
            />
          </Field>

          <Field
            label={`Sending mailboxes — ${selectedMailboxes.size} selected`}
            hint="This campaign sends only from the mailboxes you pick here, rotating across them to spread volume and protect deliverability. Connect Instantly under Sending accounts to import mailboxes."
          >
            {mailboxes.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No mailboxes yet. Connect your Instantly account under{" "}
                <strong>Sending accounts → Email</strong> to import them, then assign them here.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    value={mailboxSearch}
                    onChange={(e) => setMailboxSearch(e.target.value)}
                    placeholder="Filter mailboxes…"
                    className="h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedMailboxes(new Set(mailboxes.map((m) => m.id)))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMailboxes(new Set())}
                  >
                    Clear
                  </Button>
                </div>
                <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
                  {mailboxes
                    .filter((m) =>
                      m.email_address.toLowerCase().includes(mailboxSearch.toLowerCase()),
                    )
                    .map((m) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={selectedMailboxes.has(m.id)}
                          onCheckedChange={(c) => toggleMailbox(m.id, c === true)}
                        />
                        <span className="truncate">{m.email_address}</span>
                      </label>
                    ))}
                </div>
              </>
            )}
          </Field>

          <Field
            label="Unsubscribe footer"
            hint="Appended to the bottom of every generated email so recipients always have an opt-out. A reply-based opt-out is auto-detected and counted. Also turn on Instantly's unsubscribe link (campaign Options) for the one-click compliance header."
          >
            <div className="flex items-center gap-2">
              <Switch checked={footerEnabled} onCheckedChange={setFooterEnabled} />
              <span className="text-sm text-muted-foreground">
                {footerEnabled ? "On — added to every email" : "Off"}
              </span>
            </div>
            {footerEnabled && (
              <Textarea
                rows={2}
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder={DEFAULT_UNSUB_FOOTER}
                className="mt-2"
              />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save campaign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
