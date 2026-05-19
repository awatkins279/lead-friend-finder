import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Phone } from "lucide-react";
import { toast } from "sonner";

export type CallingConfig = {
  script_template: string | null;
  tone: string;
  objectives: string | null;
  objection_notes: string | null;
  personalization_level: string;
  record_calls: boolean;
  consent_disclaimer: string;
  extra_instructions: string | null;
};

export const DEFAULT_CALLING_CONFIG: CallingConfig = {
  script_template: null,
  tone: "consultative",
  objectives: "Book a 15-minute discovery call",
  objection_notes: null,
  personalization_level: "high",
  record_calls: false,
  consent_disclaimer: "",
  extra_instructions: null,
};

export function CallingConfigDialog({
  listId,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  listId: string;
  initial: CallingConfig;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<CallingConfig>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setCfg(initial);
  }, [open, initial]);

  const update = <K extends keyof CallingConfig>(k: K, v: CallingConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("list_call_configs")
      .upsert({ list_id: listId, ...cfg }, { onConflict: "list_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Calling config saved");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" /> Cold-call coach config
          </DialogTitle>
          <DialogDescription>
            The AI uses these settings to write a personalized NEPQ-style script for every prospect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <Field
            label="Your base script template (optional)"
            hint="Drop in your own script as a starting point. The AI keeps your structure but personalizes every line to the specific prospect."
          >
            <Textarea
              rows={6}
              value={cfg.script_template ?? ""}
              onChange={(e) => update("script_template", e.target.value)}
              placeholder="Hi {first_name}, this is {sender_name} from {sender_company}. The reason I'm calling is..."
            />
          </Field>

          <Field
            label="Call objective"
            hint="What does a successful call look like?"
          >
            <Input
              value={cfg.objectives ?? ""}
              onChange={(e) => update("objectives", e.target.value)}
              placeholder="Book a 15-minute discovery call"
            />
          </Field>

          <Field
            label="Common objections + how you want them handled"
            hint="Free-form. The AI uses this to build the objection cheat-sheet for each call."
          >
            <Textarea
              rows={4}
              value={cfg.objection_notes ?? ""}
              onChange={(e) => update("objection_notes", e.target.value)}
              placeholder={`e.g. "Send me info" → don't send anything, ask what made them say that. "Too expensive" → reframe as cost of inaction.`}
            />

          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Tone">
              <Select value={cfg.tone} onValueChange={(v) => update("tone", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultative">Consultative (NEPQ default)</SelectItem>
                  <SelectItem value="direct">Direct / no-fluff</SelectItem>
                  <SelectItem value="friendly">Friendly / peer-to-peer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Personalization level">
              <Select
                value={cfg.personalization_level}
                onValueChange={(v) => update("personalization_level", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — generic questions</SelectItem>
                  <SelectItem value="medium">Medium — role + industry refs</SelectItem>
                  <SelectItem value="high">High — hand-written feel per prospect</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>




          <Field
            label="Extra coaching instructions (optional)"
            hint="Voice samples, words to avoid, specific angles. Layered on top of NEPQ + prospect intel."
          >
            <Textarea
              rows={3}
              value={cfg.extra_instructions ?? ""}
              onChange={(e) => update("extra_instructions", e.target.value)}
              placeholder='e.g. "Always reference their recent funding round if relevant. Never use the word `synergy`."'
            />
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
