import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Upload, FileText, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  upsertSdrAgent,
  getSdrAgent,
  recordKnowledgeDoc,
  deleteKnowledgeDoc,
} from "@/lib/sdr.functions";

type AgentForm = {
  id?: string;
  name: string;
  sdr_display_name: string;
  signature: string;
  tone: "friendly" | "consultative" | "direct" | "playful";
  formality: number;
  mode: "draft" | "approve" | "auto";
  response_speed: "instant" | "fast" | "medium" | "slow";
  confidence_threshold: number;
  booking_url: string;
  hard_rules: string;
  handoff_triggers: string;
  what_selling: string;
  key_differentiators: string;
  extra_instructions: string;
};

type KnowledgeDoc = {
  id: string;
  filename: string;
  size_bytes: number | null;
  status: string;
  error: string | null;
  chunk_count: number;
};

const EMPTY: AgentForm = {
  name: "",
  sdr_display_name: "",
  signature: "",
  tone: "consultative",
  formality: 50,
  mode: "draft",
  response_speed: "medium",
  confidence_threshold: 80,
  booking_url: "",
  hard_rules: "",
  handoff_triggers: "refund, legal, lawsuit, angry, manager",
  what_selling: "",
  key_differentiators: "",
  extra_instructions: "",
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".docx", ".doc", ".txt", ".md"];

export function SdrAgentDialog({
  open,
  onOpenChange,
  agentId,
  onSaved,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentId: string | null;
  onSaved: () => void;
  userId: string;
}) {
  const [form, setForm] = useState<AgentForm>(EMPTY);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const upsert = useServerFn(upsertSdrAgent);
  const getAgent = useServerFn(getSdrAgent);
  const recordDoc = useServerFn(recordKnowledgeDoc);
  const removeDoc = useServerFn(deleteKnowledgeDoc);

  useEffect(() => {
    if (!open) return;
    if (!agentId) {
      setForm(EMPTY);
      setDocs([]);
      setSavedId(null);
      return;
    }
    setLoading(true);
    getAgent({ data: { id: agentId } })
      .then((r) => {
        const a = r.agent as Partial<AgentForm> & { id: string };
        setForm({
          ...EMPTY,
          ...a,
          booking_url: a.booking_url ?? "",
          sdr_display_name: a.sdr_display_name ?? "",
          signature: a.signature ?? "",
          hard_rules: a.hard_rules ?? "",
          handoff_triggers: a.handoff_triggers ?? "",
          what_selling: a.what_selling ?? "",
          key_differentiators: a.key_differentiators ?? "",
          extra_instructions: a.extra_instructions ?? "",
        });
        setSavedId(a.id);
        setDocs(r.docs as KnowledgeDoc[]);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open, agentId]);

  const update = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Give your agent a name");
      return;
    }
    setSaving(true);
    try {
      const r = await upsert({ data: { ...form, id: savedId ?? undefined } });
      setSavedId(r.id);
      toast.success(savedId ? "Agent updated" : "Agent created");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!savedId) {
      toast.error("Save the agent first, then upload knowledge files");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File too large — 25 MB max");
      return;
    }
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      toast.error(`Unsupported file type. Allowed: ${ALLOWED_EXT.join(", ")}`);
      return;
    }
    setUploading(true);
    try {
      const path = `${userId}/${savedId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("sdr-knowledge")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { doc } = await recordDoc({
        data: {
          agent_id: savedId,
          filename: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
        },
      });
      setDocs((d) => [doc as KnowledgeDoc, ...d]);
      toast.success("Uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (!confirm("Remove this file?")) return;
    try {
      await removeDoc({ data: { id } });
      setDocs((d) => d.filter((x) => x.id !== id));
      toast.success("Removed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agentId ? "Edit AI SDR Agent" : "New AI SDR Agent"}</DialogTitle>
          <DialogDescription>
            Build a reusable agent profile. Once saved, you can assign it to any campaign.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <Tabs defaultValue="identity" className="mt-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="offer">Offer</TabsTrigger>
              <TabsTrigger value="behavior">Behavior</TabsTrigger>
              <TabsTrigger value="knowledge" disabled={!savedId}>
                Knowledge {docs.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {docs.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="identity" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Agent name (internal)</Label>
                <Input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Sarah – SaaS outbound"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>SDR display name (in emails)</Label>
                  <Input
                    value={form.sdr_display_name}
                    onChange={(e) => update("sdr_display_name", e.target.value)}
                    placeholder="Sarah Chen"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <Select
                    value={form.tone}
                    onValueChange={(v) => update("tone", v as AgentForm["tone"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="friendly">Friendly</SelectItem>
                      <SelectItem value="consultative">Consultative</SelectItem>
                      <SelectItem value="direct">Direct</SelectItem>
                      <SelectItem value="playful">Playful</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Formality — {form.formality}/100</Label>
                <Slider
                  value={[form.formality]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) => update("formality", v[0])}
                />
                <p className="text-xs text-muted-foreground">
                  0 = casual ("hey, quick one"), 100 = formal ("Dear Mr. Smith")
                </p>
              </div>
              <div className="space-y-2">
                <Label>Email signature</Label>
                <Textarea
                  rows={3}
                  value={form.signature}
                  onChange={(e) => update("signature", e.target.value)}
                  placeholder={"Sarah Chen\nAcme Co · sarah@acme.com\nacme.com"}
                />
              </div>
            </TabsContent>

            <TabsContent value="offer" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>What you're selling</Label>
                <Textarea
                  rows={3}
                  value={form.what_selling}
                  onChange={(e) => update("what_selling", e.target.value)}
                  placeholder="A B2B sales-automation platform that..."
                />
              </div>
              <div className="space-y-2">
                <Label>Top differentiators</Label>
                <Textarea
                  rows={3}
                  value={form.key_differentiators}
                  onChange={(e) => update("key_differentiators", e.target.value)}
                  placeholder="1. 3x faster setup vs Outreach&#10;2. Built-in dialer included&#10;3. No per-seat fees"
                />
              </div>
              <div className="space-y-2">
                <Label>Extra context / playbook notes</Label>
                <Textarea
                  rows={3}
                  value={form.extra_instructions}
                  onChange={(e) => update("extra_instructions", e.target.value)}
                  placeholder="Anything else the AI should know about your offer, your buyers, or how you sell."
                />
              </div>
            </TabsContent>

            <TabsContent value="behavior" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Reply mode</Label>
                  <Select
                    value={form.mode}
                    onValueChange={(v) => update("mode", v as AgentForm["mode"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft only (you send)</SelectItem>
                      <SelectItem value="approve">Auto-send after approval</SelectItem>
                      <SelectItem value="auto">Full auto-send (high confidence)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Response speed</Label>
                  <Select
                    value={form.response_speed}
                    onValueChange={(v) =>
                      update("response_speed", v as AgentForm["response_speed"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instant">Instant (&lt; 1 min)</SelectItem>
                      <SelectItem value="fast">Fast (5–30 min, random)</SelectItem>
                      <SelectItem value="medium">Medium (30 min – 2 hr)</SelectItem>
                      <SelectItem value="slow">Slow (2–8 hr, looks human)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.mode === "auto" && (
                <div className="space-y-2">
                  <Label>Auto-send confidence threshold — {form.confidence_threshold}%</Label>
                  <Slider
                    value={[form.confidence_threshold]}
                    min={50}
                    max={100}
                    step={5}
                    onValueChange={(v) => update("confidence_threshold", v[0])}
                  />
                  <p className="text-xs text-muted-foreground">
                    Replies below this confidence get held as drafts for review.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Booking link (Calendly / Cal.com)</Label>
                <Input
                  value={form.booking_url}
                  onChange={(e) => update("booking_url", e.target.value)}
                  placeholder="https://cal.com/sarah/15min"
                />
              </div>
              <div className="space-y-2">
                <Label>Hard rules</Label>
                <Textarea
                  rows={3}
                  value={form.hard_rules}
                  onChange={(e) => update("hard_rules", e.target.value)}
                  placeholder={"Never quote pricing.\nAlways offer a demo.\nNever promise specific delivery dates."}
                />
              </div>
              <div className="space-y-2">
                <Label>Handoff triggers (comma-separated keywords)</Label>
                <Textarea
                  rows={2}
                  value={form.handoff_triggers}
                  onChange={(e) => update("handoff_triggers", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If a reply mentions these, the AI saves a draft and notifies you instead of auto-sending.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="knowledge" className="space-y-3 pt-4">
              {!savedId ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Save the agent first, then upload knowledge files.
                </div>
              ) : (
                <>
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                    <p className="text-sm font-medium">Upload case studies, pricing, FAQs, product docs</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PDF · DOCX · TXT · MD · 25 MB max each
                    </p>
                    <label className="mt-3 inline-block">
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md"
                        disabled={uploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(f);
                          e.target.value = "";
                        }}
                      />
                      <Button variant="outline" size="sm" disabled={uploading} asChild>
                        <span>
                          {uploading ? (
                            <>
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Uploading…
                            </>
                          ) : (
                            <>
                              <Upload className="mr-2 h-3.5 w-3.5" /> Choose file
                            </>
                          )}
                        </span>
                      </Button>
                    </label>
                  </div>

                  <div className="rounded-md border border-amber-500/30 bg-amber-50/30 p-3 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                    Files are stored and listed now. The chunk &amp; embed pipeline that
                    lets the AI cite from them ships in the next update.
                  </div>

                  {docs.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      No files yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {docs.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center gap-3 rounded-md border bg-card p-3"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{d.filename}</div>
                            <div className="text-xs text-muted-foreground">
                              {d.size_bytes ? `${(d.size_bytes / 1024).toFixed(0)} KB` : "—"} ·{" "}
                              {d.status}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteDoc(d.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {savedId ? "Save changes" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
