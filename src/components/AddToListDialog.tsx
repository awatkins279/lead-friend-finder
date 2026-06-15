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

const CAMPAIGN_ADD_LIMIT = 75000;

export function AddToListDialog({
  open,
  onOpenChange,
  leadIds,
  onAdded,
  mode = "list",
  leadScores,
  leadVerifications,
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
  /** Optional per-lead email-verification status. When provided in campaign mode,
   * a "Deliverable only" toggle appears (default ON) that excludes any lead whose
   * status isn't "deliverable". */
  leadVerifications?: Map<string, "deliverable" | "risky" | "invalid" | "disposable" | "unknown">;
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
  const [allowedVerification, setAllowedVerification] = useState<
    "deliverable" | "deliverable_risky"
  >("deliverable");

  const isCampaign = mode === "campaign";
  const noun = isCampaign ? "campaign" : "list";
  const hasScores = !!leadScores && leadScores.size > 0;
  const showScoreFilter = isCampaign && hasScores;
  const hasVerifications = !!leadVerifications;
  const showVerifyFilter = isCampaign && hasVerifications;

  const scoreOf = (id: string): number | null => {
    if (!leadScores) return null;
    const v = leadScores.get(id);
    return typeof v === "number" ? v : null;
  };

  const verifiedCounts = useMemo(() => {
    const counts = { deliverable: 0, risky: 0, invalid: 0, unknown: 0, unverified: 0 };
    if (!showVerifyFilter) return counts;
    for (const id of leadIds) {
      const s = leadVerifications!.get(id);
      if (!s) counts.unverified += 1;
      else if (s === "deliverable") counts.deliverable += 1;
      else if (s === "risky") counts.risky += 1;
      else if (s === "invalid" || s === "disposable") counts.invalid += 1;
      else counts.unknown += 1;
    }
    return counts;
  }, [leadIds, leadVerifications, showVerifyFilter]);

  const effectiveIds = useMemo(() => {
    let ids = leadIds;
    if (showScoreFilter) {
      ids = ids.filter((id) => {
        if (overrides.has(id)) return true;
        const s = scoreOf(id);
        if (s == null) return false;
        return s >= minScore;
      });
    }
    if (showVerifyFilter) {
      ids = ids.filter((id) => {
        if (overrides.has(id)) return true;
        const status = leadVerifications!.get(id);
        return (
          status === "deliverable" ||
          (allowedVerification === "deliverable_risky" && status === "risky")
        );
      });
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    leadIds,
    leadScores,
    minScore,
    overrides,
    showScoreFilter,
    leadVerifications,
    allowedVerification,
    showVerifyFilter,
  ]);

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
        setLists(rows);
        setSelectedId(rows[0]?.id ?? "");
      });
  }, [open, isCampaign]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(q));
  }, [lists, search]);

  const submit = async () => {
    const idsToAdd = showScoreFilter || showVerifyFilter ? effectiveIds : leadIds;
    if (idsToAdd.length === 0) {
      toast.error(
        showVerifyFilter
          ? "No deliverable prospects in the current filter."
          : showScoreFilter
            ? "No prospects pass the threshold. Lower it or override individuals."
            : "No leads selected",
      );
      return;
    }
    if (isCampaign && idsToAdd.length > CAMPAIGN_ADD_LIMIT) {
      toast.error(
        `You can add up to ${CAMPAIGN_ADD_LIMIT.toLocaleString()} leads to a campaign at one time.`,
      );
      return;
    }
    setBusy(true);
    try {
      let listId = selectedId;
      if (!listId) {
        if (!newName.trim()) {
          toast.error(`Pick a ${noun} or name a new one`);
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

      const rows = idsToAdd.map((id) => ({
        list_id: listId,
        lead_id: id,
        ...(isCampaign && leadVerifications
          ? { verification_status: leadVerifications.get(id) ?? null }
          : {}),
      }));
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: insErr } = await supabase
          .from("list_leads")
          .upsert(slice, { onConflict: "list_id,lead_id", ignoreDuplicates: !allowDuplicates });
        if (insErr) throw insErr;
      }

      toast.success(`Added ${idsToAdd.length} lead${idsToAdd.length === 1 ? "" : "s"} to ${noun}`);
      onAdded?.();
      onOpenChange(false);
      setNewName("");
      setNewDesc("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to add");
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
              ? `Add these prospects to an existing campaign or create a new draft campaign for them. Up to ${CAMPAIGN_ADD_LIMIT.toLocaleString()} can be added at once.`
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
                  <Badge variant="secondary" className="text-[10px]">
                    configured
                  </Badge>
                )}
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
              <input type="radio" checked={selectedId === ""} onChange={() => setSelectedId("")} />
              <Plus className="h-3.5 w-3.5" /> Create new {noun}
            </label>
          </div>
        </div>

        {selectedId === "" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">New {noun} name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={isCampaign ? "e.g. Validated SaaS founders" : "e.g. NYC SaaS founders"}
              />
            </div>
            <div>
              <Label className="text-xs">Description (used by AI for personalization)</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What are you selling and to whom?"
              />
            </div>
            {isCampaign && (
              <p className="text-[11px] text-muted-foreground">
                The campaign will be saved as a draft. You can configure its sender, sequence, and
                schedule after adding these prospects.
              </p>
            )}
          </div>
        )}

        {showVerifyFilter && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">Email quality to include</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={allowedVerification === "deliverable" ? "default" : "outline"}
                onClick={() => setAllowedVerification("deliverable")}
              >
                Deliverable only
              </Button>
              <Button
                type="button"
                size="sm"
                variant={allowedVerification === "deliverable_risky" ? "default" : "outline"}
                onClick={() => setAllowedVerification("deliverable_risky")}
              >
                Deliverable + risky
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400">
                {verifiedCounts.deliverable.toLocaleString()} deliverable
              </Badge>
              {verifiedCounts.risky > 0 && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-400">
                  {verifiedCounts.risky.toLocaleString()} risky
                </Badge>
              )}
              {verifiedCounts.invalid > 0 && (
                <Badge variant="outline" className="bg-rose-500/10 text-rose-400">
                  {verifiedCounts.invalid.toLocaleString()} invalid
                </Badge>
              )}
              {verifiedCounts.unknown > 0 && (
                <Badge variant="outline">{verifiedCounts.unknown.toLocaleString()} unknown</Badge>
              )}
              {verifiedCounts.unverified > 0 && (
                <Badge variant="outline">
                  {verifiedCounts.unverified.toLocaleString()} not verified
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {effectiveIds.length.toLocaleString()} of {leadIds.length.toLocaleString()} will be
              added.
            </p>
          </div>
        )}

        {showScoreFilter && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide">
                  Minimum AI score
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={minScore}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n))
                        setMinScore(Math.max(0, Math.min(100, Math.round(n))));
                    }}
                    className="h-7 w-16 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </div>
              </div>
              <Slider
                value={[minScore]}
                onValueChange={(v) => setMinScore(v[0] ?? 0)}
                min={0}
                max={100}
                step={1}
                className="mt-3"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {effectiveIds.length.toLocaleString()} of {leadIds.length.toLocaleString()} will be
                added. Below-threshold prospects are flagged — tick to override.
              </p>
            </div>

            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded border bg-background p-1">
              {leadIds.map((id) => {
                const s = scoreOf(id);
                const passes = s != null && s >= minScore;
                const overridden = overrides.has(id);
                const included = passes || overridden;
                return (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Checkbox
                      checked={included}
                      onCheckedChange={(v) => {
                        setOverrides((prev) => {
                          const next = new Set(prev);
                          if (v) {
                            if (!passes) next.add(id);
                            else next.delete(id);
                          } else {
                            if (passes)
                              next.add(id); // suppress a passing one via override-off? skip
                            else next.delete(id);
                          }
                          // Simpler model: override toggles "force include" for non-passing leads only
                          return next;
                        });
                      }}
                      disabled={passes}
                    />
                    <span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">
                      {id.slice(0, 10)}…
                    </span>
                    {s == null ? (
                      <Badge variant="outline" className="text-[10px]">
                        Not scored
                      </Badge>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          passes
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                        }`}
                      >
                        {!passes && <AlertTriangle className="h-2.5 w-2.5" />}
                        {s}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={allowDuplicates} onCheckedChange={(v) => setAllowDuplicates(!!v)} />
          Allow duplicates
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy
              ? "Saving…"
              : isCampaign
                ? `Add ${(showScoreFilter || showVerifyFilter ? effectiveIds.length : leadIds.length).toLocaleString()} to Campaign`
                : "Save Leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
