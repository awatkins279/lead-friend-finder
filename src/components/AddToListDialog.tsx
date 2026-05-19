import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type ListRow = { id: string; name: string; sender_name: string | null };

export function AddToListDialog({
  open,
  onOpenChange,
  leadIds,
  onAdded,
  mode = "list",
  leadScores,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  onAdded?: () => void;
  mode?: "list" | "campaign";
  /** Optional per-lead score (0-100). When provided in campaign mode, a min-score
   * filter is shown and below-threshold leads are flagged but excluded unless
   * the user explicitly overrides them. */
  leadScores?: Map<string, number | null | undefined>;
}) {
  const [lists, setLists] = useState<ListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [search, setSearch] = useState("");
  const [allowDuplicates, setAllowDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [minScore, setMinScore] = useState(70);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());

  const isCampaign = mode === "campaign";
  const noun = isCampaign ? "campaign" : "list";
  const hasScores = !!leadScores && leadScores.size > 0;
  const showScoreFilter = isCampaign && hasScores;

  const scoreOf = (id: string): number | null => {
    if (!leadScores) return null;
    const v = leadScores.get(id);
    return typeof v === "number" ? v : null;
  };

  const effectiveIds = useMemo(() => {
    if (!showScoreFilter) return leadIds;
    return leadIds.filter((id) => {
      if (overrides.has(id)) return true;
      const s = scoreOf(id);
      if (s == null) return false; // unscored excluded unless overridden
      return s >= minScore;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIds, leadScores, minScore, overrides, showScoreFilter]);

  // Reset overrides when dialog opens
  useEffect(() => {
    if (open) setOverrides(new Set());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setAllowDuplicates(true);
    supabase
      .from("lists")
      .select("id, name, sender_name")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as ListRow[];
        const filtered = isCampaign ? rows.filter((r) => !!r.sender_name) : rows;
        setLists(filtered);
        setSelectedId(filtered[0]?.id ?? "");
      });
  }, [open, isCampaign]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, search]);

  const submit = async () => {
    const idsToAdd = showScoreFilter ? effectiveIds : leadIds;
    if (idsToAdd.length === 0) {
      toast.error(showScoreFilter ? "No prospects pass the threshold. Lower it or override individuals." : "No leads selected");
      return;
    }
    setBusy(true);
    try {
      let listId = selectedId;
      if (!listId) {
        if (isCampaign) {
          toast.error("Pick a campaign");
          return;
        }
        if (!newName.trim()) {
          toast.error("Pick a list or name a new one");
          return;
        }
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data: created, error } = await supabase
          .from("lists")
          .insert({ user_id: u.user.id, name: newName.trim(), description: newDesc.trim() || null })
          .select("id")
          .single();
        if (error) throw error;
        listId = created.id;
      }

      const rows = idsToAdd.map((id) => ({ list_id: listId, lead_id: id }));
      const { error: insErr } = await supabase
        .from("list_leads")
        .upsert(rows, { onConflict: "list_id,lead_id", ignoreDuplicates: !allowDuplicates });
      if (insErr) throw insErr;

      toast.success(
        `Added ${idsToAdd.length} lead${idsToAdd.length === 1 ? "" : "s"} to ${noun}`,
      );
      onAdded?.();
      onOpenChange(false);
      setNewName("");
      setNewDesc("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Add {leadIds.length.toLocaleString()} contact{leadIds.length === 1 ? "" : "s"} to {noun}
          </DialogTitle>
          <DialogDescription>
            {isCampaign
              ? "Enroll these prospects into a configured campaign."
              : "Group these prospects so you can research them and draft personalized emails."}
          </DialogDescription>
        </DialogHeader>


        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun}s by name`}
              className="pl-8"
            />
          </div>

          <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
            {visible.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No {noun}s found
              </div>
            )}
            {visible.map((l) => (
              <label
                key={l.id}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent ${selectedId === l.id ? "bg-accent" : ""}`}
              >
                <input
                  type="radio"
                  checked={selectedId === l.id}
                  onChange={() => setSelectedId(l.id)}
                />
                <span className="flex-1 truncate">{l.name}</span>
                {isCampaign && l.sender_name && (
                  <Badge variant="secondary" className="text-[10px]">configured</Badge>
                )}
              </label>
            ))}
            {!isCampaign && (
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                <input
                  type="radio"
                  checked={selectedId === ""}
                  onChange={() => setSelectedId("")}
                />
                <Plus className="h-3.5 w-3.5" /> Create new list
              </label>
            )}
          </div>
        </div>

        {!isCampaign && selectedId === "" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">New list name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. NYC SaaS founders" />
            </div>
            <div>
              <Label className="text-xs">Description (used by AI for personalization)</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What are you selling and to whom?"
              />
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allowDuplicates}
            onCheckedChange={(v) => setAllowDuplicates(!!v)}
          />
          Allow duplicates
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : isCampaign ? "Add to Campaign" : "Save Leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
