import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Upload, Trash2, FileText, BookOpen, X } from "lucide-react";
import { toast } from "sonner";
import {
  listCoachingStyles,
  type CoachingStyle,
  setListCoaching,
  listCampaignKnowledge,
  addCampaignKnowledge,
  deleteCampaignKnowledge,
} from "@/lib/coaching.functions";

type KnowledgeDoc = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  chunk_count: number;
  created_at: string;
};

export function CallCoachingDialog({
  listId,
  initialStyleId,
  initialEnabled,
  open,
  onOpenChange,
  onSaved,
}: {
  listId: string;
  initialStyleId: string | null;
  initialEnabled: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [styles, setStyles] = useState<CoachingStyle[]>([]);
  const [styleId, setStyleId] = useState<string | null>(initialStyleId);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [pasteName, setPasteName] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStyles = useServerFn(listCoachingStyles);
  const fetchDocs = useServerFn(listCampaignKnowledge);
  const saveCoach = useServerFn(setListCoaching);
  const addKnow = useServerFn(addCampaignKnowledge);
  const delKnow = useServerFn(deleteCampaignKnowledge);

  useEffect(() => {
    if (!open) return;
    setStyleId(initialStyleId);
    setEnabled(initialEnabled);
    fetchStyles()
      .then((r) => setStyles(r.styles))
      .catch((e) => toast.error(String(e.message ?? e)));
    fetchDocs({ data: { list_id: listId } })
      .then((r) => setDocs(r.docs as KnowledgeDoc[]))
      .catch(() => {});
  }, [open, initialStyleId, initialEnabled, listId, fetchStyles, fetchDocs]);

  const save = async () => {
    setBusy(true);
    try {
      await saveCoach({
        data: { list_id: listId, coaching_style_id: styleId, ai_copilot_enabled: enabled },
      });
      toast.success("Coaching settings saved");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const addPaste = async () => {
    if (!pasteName.trim() || pasteContent.trim().length < 20) {
      toast.error("Give it a name and at least 20 characters of content");
      return;
    }
    setBusy(true);
    try {
      await addKnow({
        data: {
          list_id: listId,
          filename: pasteName.trim(),
          content: pasteContent,
          mime_type: "text/plain",
        },
      });
      setPasteName("");
      setPasteContent("");
      const r = await fetchDocs({ data: { list_id: listId } });
      setDocs(r.docs as KnowledgeDoc[]);
      toast.success("Knowledge added");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const addFile = async (file: File) => {
    if (file.size > 1_000_000) {
      toast.error("File must be under 1 MB. For now we only accept text files (.txt, .md).");
      return;
    }
    const text = await file.text();
    setBusy(true);
    try {
      await addKnow({
        data: {
          list_id: listId,
          filename: file.name,
          content: text,
          mime_type: file.type || "text/plain",
        },
      });
      const r = await fetchDocs({ data: { list_id: listId } });
      setDocs(r.docs as KnowledgeDoc[]);
      toast.success(`Indexed ${file.name}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await delKnow({ data: { id } });
      setDocs((d) => d.filter((x) => x.id !== id));
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedStyle =
    styles.find((s) => s.id === styleId) ?? styles.find((s) => s.is_default) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI Co-Pilot
          </DialogTitle>
          <DialogDescription>
            During a live call the AI listens to both sides, follows along with the script, and
            tells the rep what to say next — grounded in the trainer style and the product knowledge
            below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Toggle */}
          <div className="glass-panel flex items-center justify-between rounded-xl p-4">
            <div>
              <div className="font-medium">Enable AI co-pilot for this campaign</div>
              <div className="text-xs text-muted-foreground">
                When ON, calls in this campaign route through Twilio so the browser can hear both
                sides for transcription. When OFF, calls behave as they do today.
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Trainer style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Coaching style</Label>
            <Select value={styleId ?? ""} onValueChange={(v) => setStyleId(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Use the default style" />
              </SelectTrigger>
              <SelectContent>
                {styles.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedStyle?.description && (
              <p className="text-xs text-muted-foreground">{selectedStyle.description}</p>
            )}
          </div>

          {/* Knowledge */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <Label className="text-sm font-medium">Product knowledge (this campaign)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste case studies, battlecards, pricing notes, or any context about what you're
              selling. The AI pulls the most relevant passages into every live suggestion during the
              call. (Text only for now — .txt / .md files or paste below. PDF support coming.)
            </p>

            <div className="space-y-2 rounded-xl border border-border/50 p-3">
              <Input
                placeholder="Source name (e.g. Product one-pager)"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
              />
              <Textarea
                rows={5}
                placeholder="Paste any text the AI should know about your product / pricing / objections / case studies…"
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={addPaste} disabled={busy}>
                  Add to knowledge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <Upload className="mr-1 h-4 w-4" /> Upload .txt / .md
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void addFile(f);
                  }}
                />
              </div>
            </div>

            {docs.length > 0 && (
              <ul className="divide-y divide-border/50 rounded-xl border border-border/50">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.filename}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.chunk_count} chunks · {d.status}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(d.id)}
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
