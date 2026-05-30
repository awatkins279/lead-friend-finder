import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GraduationCap, Plus, Pencil, Trash2, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import {
  listCoachingStyles,
  upsertCoachingStyle,
  deleteCoachingStyle,
  type CoachingStyle,
} from "@/lib/coaching.functions";

export const Route = createFileRoute("/app/coaching-styles")({
  component: CoachingStylesPage,
  errorComponent: ({ error }) => (
    <div className="glass-panel rounded-2xl p-8 text-sm" role="alert">
      Couldn't load coaching styles: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm">Not found</div>,
});

type EditState = {
  id?: string;
  name: string;
  description: string;
  system_prompt: string;
  hard_rules: string;
  example_objection_handlers: { objection: string; response: string }[];
  is_default: boolean;
};

const EMPTY: EditState = {
  name: "",
  description: "",
  system_prompt: "",
  hard_rules: "",
  example_objection_handlers: [],
  is_default: false,
};

function CoachingStylesPage() {
  const [styles, setStyles] = useState<CoachingStyle[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const fetchStyles = useServerFn(listCoachingStyles);
  const upsert = useServerFn(upsertCoachingStyle);
  const del = useServerFn(deleteCoachingStyle);

  const reload = () =>
    fetchStyles().then((r) => {
      setStyles(r.styles);
      setIsAdmin(r.isAdmin);
      setReady(true);
    });

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEdit(EMPTY);
    setOpen(true);
  };
  const openEdit = (s: CoachingStyle) => {
    setEdit({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      system_prompt: s.system_prompt,
      hard_rules: s.hard_rules ?? "",
      example_objection_handlers: s.example_objection_handlers ?? [],
      is_default: s.is_default,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!edit.name.trim() || edit.system_prompt.trim().length < 20) {
      toast.error("Name + at least 20 chars of system prompt");
      return;
    }
    setBusy(true);
    try {
      await upsert({
        data: {
          id: edit.id,
          name: edit.name.trim(),
          description: edit.description || null,
          system_prompt: edit.system_prompt,
          hard_rules: edit.hard_rules || null,
          example_objection_handlers: edit.example_objection_handlers.filter(
            (o) => o.objection.trim() && o.response.trim(),
          ),
          is_default: edit.is_default,
        },
      });
      toast.success("Saved");
      setOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this style?")) return;
    try {
      await del({ data: { id } });
      await reload();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  };

  const addObj = () =>
    setEdit((e) => ({
      ...e,
      example_objection_handlers: [...e.example_objection_handlers, { objection: "", response: "" }],
    }));

  if (!ready) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <header className="glass-panel-strong flex items-center justify-between rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="ring-glow grid h-11 w-11 place-items-center rounded-xl bg-[var(--gradient-aurora)]">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Coaching styles</h1>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Train the AI on the sales methodologies you like. Each style becomes selectable per campaign."
                : "Curated coaching styles available across all campaigns. Admins manage these."}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> New style
          </Button>
        )}
      </header>

      <div className="grid gap-3">
        {styles.length === 0 && (
          <div className="glass-panel rounded-2xl p-8 text-center text-sm text-muted-foreground">
            No coaching styles yet.
          </div>
        )}
        {styles.map((s) => (
          <div key={s.id} className="glass-panel rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">{s.name}</h3>
                  {s.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--gradient-aurora-soft)] px-2 py-0.5 text-[10px] font-medium">
                      <Star className="h-3 w-3" /> Default
                    </span>
                  )}
                </div>
                {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground/80">{s.system_prompt}</p>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {s.example_objection_handlers?.length ?? 0} example handlers
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit.id ? "Edit coaching style" : "New coaching style"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. NEPQ (Jeremy Miner)"
                />
              </div>
              <div className="flex items-end gap-3">
                <Switch
                  checked={edit.is_default}
                  onCheckedChange={(v) => setEdit((s) => ({ ...s, is_default: v }))}
                />
                <span className="pb-2 text-sm">Set as default style</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Short description</Label>
              <Input
                value={edit.description}
                onChange={(e) => setEdit((s) => ({ ...s, description: e.target.value }))}
                placeholder="One-line summary"
              />
            </div>

            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <p className="text-xs text-muted-foreground">
                This is the instructions the live AI follows during every call. Train it on the style you want — tone,
                question patterns, framing rules, phrases to avoid, etc.
              </p>
              <Textarea
                rows={10}
                value={edit.system_prompt}
                onChange={(e) => setEdit((s) => ({ ...s, system_prompt: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Hard rules (optional)</Label>
              <Textarea
                rows={4}
                value={edit.hard_rules}
                onChange={(e) => setEdit((s) => ({ ...s, hard_rules: e.target.value }))}
                placeholder="Things the AI must never do. e.g. Never pitch features before the prospect names the problem."
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Example objection handlers</Label>
                <Button size="sm" variant="outline" onClick={addObj}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Few-shot examples. The AI uses these as patterns when crafting live responses.
              </p>
              {edit.example_objection_handlers.map((o, i) => (
                <div key={i} className="space-y-1 rounded-lg border border-border/50 p-2">
                  <Input
                    placeholder="Objection"
                    value={o.objection}
                    onChange={(e) =>
                      setEdit((s) => ({
                        ...s,
                        example_objection_handlers: s.example_objection_handlers.map((x, j) =>
                          j === i ? { ...x, objection: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Textarea
                    rows={2}
                    placeholder="Ideal response in this style"
                    value={o.response}
                    onChange={(e) =>
                      setEdit((s) => ({
                        ...s,
                        example_objection_handlers: s.example_objection_handlers.map((x, j) =>
                          j === i ? { ...x, response: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEdit((s) => ({
                        ...s,
                        example_objection_handlers: s.example_objection_handlers.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save style"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
