import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  Filter,
  MapPin,
  Building2,
  Briefcase,
  X,
  Linkedin,
  Mail,
  Phone,
  Globe,
  Save,
  ChevronDown,
  Download,
  Sparkles,
  ListPlus,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { AddToListDialog } from "@/components/AddToListDialog";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Target, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { scoreLeads as scoreLeadsFn } from "@/lib/score.functions";

type ScoreInfo = { score: number; reasoning: string };


export const Route = createFileRoute("/app/people")({
  component: PeoplePage,
  head: () => ({ meta: [{ title: "People Search — NexusAi" }] }),
});

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  org_name: string | null;
  org_description: string | null;
  org_website_url: string | null;
  org_industry: string | null;
  org_employee_count: string | null;
};

type Filters = {
  title: string;
  company: string;
  location: string;
  industry: string;
  hasPhone: boolean;
  hasEmail: boolean;
};

const EMPTY: Filters = {
  title: "",
  company: "",
  location: "",
  industry: "",
  hasPhone: false,
  hasEmail: false,
};

const PAGE_SIZE = 25;
const MAX_BULK = 50000;

function applyFilters<T extends { select: any; ilike: any; or: any; not: any; neq: any }>(q: T, f: Filters): T {
  let r: any = q;
  if (f.title.trim()) r = r.ilike("title", `%${f.title.trim()}%`);
  if (f.company.trim()) r = r.ilike("org_name", `%${f.company.trim()}%`);
  if (f.industry.trim()) r = r.ilike("org_industry", `%${f.industry.trim()}%`);
  if (f.location.trim()) {
    const t = f.location.trim();
    r = r.or(`city.ilike.%${t}%,state.ilike.%${t}%,country.ilike.%${t}%`);
  }
  if (f.hasPhone) r = r.not("phone", "is", null).neq("phone", "");
  if (f.hasEmail) r = r.not("email", "is", null).neq("email", "");
  return r;
}

async function fetchMatchingIds(filters: Filters, limit: number): Promise<string[]> {
  const ids: string[] = [];
  const chunk = 1000;
  let offset = 0;
  while (ids.length < limit) {
    const take = Math.min(chunk, limit - ids.length);
    let q: any = supabase.from("leads").select("id");
    q = applyFilters(q, filters);
    q = q.order("last_name", { ascending: true, nullsFirst: false }).range(offset, offset + take - 1);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    rows.forEach((r) => ids.push(r.id));
    if (rows.length < take) break;
    offset += take;
  }
  return ids;
}

function PeoplePage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [advancedN, setAdvancedN] = useState("1000");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const [scoringContext, setScoringContext] = useState("");
  const [scores, setScores] = useState<Map<string, ScoreInfo>>(new Map());
  const [minScore, setMinScore] = useState(0);
  const [scoringBusy, setScoringBusy] = useState(false);
  const scoreLeadsCall = useServerFn(scoreLeadsFn);

  useEffect(() => setPage(0), [filters]);


  const queryKey = useMemo(() => ["leads", filters, page], [filters, page]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      let q: any = supabase
        .from("leads")
        .select(
          "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name,org_description,org_website_url,org_industry,org_employee_count",
          { count: "exact" },
        );
      q = applyFilters(q, filters);
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.order("last_name", { ascending: true, nullsFirst: false }).range(from, to);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Lead[], count: count ?? 0 };
    },
  });

  const total = data?.count ?? 0;
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeChips = (Object.keys(filters) as (keyof Filters)[]).filter((k) => {
    const v = filters[k];
    return typeof v === "string" ? v.trim() !== "" : v === true;
  });
  const allPageChecked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const somePageChecked = rows.some((r) => picked.has(r.id));

  const apply = () => setFilters(draft);
  const clear = () => {
    setDraft(EMPTY);
    setFilters(EMPTY);
  };

  const saveSearch = async () => {
    const name = window.prompt("Name this saved search");
    if (!name) return;
    const { data: session } = await supabase.auth.getUser();
    if (!session.user) return;
    const { error } = await supabase.from("saved_searches").insert({
      user_id: session.user.id,
      name,
      filters: filters as any,
    });
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  const selectThisPage = () => {
    setPicked((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
    setSelectMenuOpen(false);
    setAdvancedMode(false);
  };

  const selectAllMatching = async () => {
    setBulkBusy(true);
    try {
      const ids = await fetchMatchingIds(filters, Math.min(total || MAX_BULK, MAX_BULK));
      setPicked(new Set(ids));
      toast.success(`${ids.length.toLocaleString()} leads selected`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to select");
    } finally {
      setBulkBusy(false);
      setSelectMenuOpen(false);
      setAdvancedMode(false);
    }
  };

  const applyAdvanced = async () => {
    const n = Math.max(1, Math.min(MAX_BULK, parseInt(advancedN, 10) || 0));
    if (n <= 0) {
      toast.error("Enter a positive number");
      return;
    }
    setBulkBusy(true);
    try {
      const ids = await fetchMatchingIds(filters, n);
      setPicked(new Set(ids));
      toast.success(`${ids.length.toLocaleString()} leads selected`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to select");
    } finally {
      setBulkBusy(false);
      setSelectMenuOpen(false);
      setAdvancedMode(false);
    }
  };

  const clearSelection = () => {
    setPicked(new Set());
    setSelectMenuOpen(false);
    setAdvancedMode(false);
  };

  const exportCsv = async () => {
    setExportBusy(true);
    try {
      let ids: string[] = Array.from(picked);
      if (ids.length === 0) {
        ids = await fetchMatchingIds(filters, Math.min(total || MAX_BULK, MAX_BULK));
      }
      const all: Lead[] = [];
      const cols =
        "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name,org_description,org_website_url,org_industry,org_employee_count";
      for (let i = 0; i < ids.length; i += 1000) {
        const slice = ids.slice(i, i + 1000);
        const { data, error } = await supabase.from("leads").select(cols).in("id", slice);
        if (error) throw error;
        all.push(...((data ?? []) as Lead[]));
      }
      const headers = cols.split(",");
      const escape = (v: any) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        headers.join(","),
        ...all.map((r) => headers.map((h) => escape((r as any)[h])).join(",")),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length.toLocaleString()} leads`);
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const hasSelection = picked.size > 0;

  const scorePageLeads = async () => {
    if (!scoringContext.trim() || scoringContext.trim().length < 10) {
      toast.error("Tell the AI what you're selling (min 10 chars)");
      return;
    }
    const ids = rows.map((r) => r.id).filter((id) => !scores.has(id));
    if (ids.length === 0) {
      toast.info("All visible leads are already scored");
      return;
    }
    setScoringBusy(true);
    try {
      const { scores: out } = await scoreLeadsCall({
        data: { leadIds: ids, context: scoringContext.trim() },
      });
      setScores((prev) => {
        const next = new Map(prev);
        out.forEach((s) => next.set(s.leadId, { score: s.score, reasoning: s.reasoning }));
        return next;
      });
      toast.success(`Scored ${out.length} leads`);
    } catch (e: any) {
      toast.error(e.message ?? "Scoring failed");
    } finally {
      setScoringBusy(false);
    }
  };

  const scoreSelectedLeads = async () => {
    if (!scoringContext.trim() || scoringContext.trim().length < 10) {
      toast.error("Tell the AI what you're selling (min 10 chars)");
      return;
    }
    const allIds = Array.from(picked).filter((id) => !scores.has(id));
    if (allIds.length === 0) {
      toast.info("All selected leads are already scored");
      return;
    }
    setScoringBusy(true);
    try {
      let done = 0;
      for (let i = 0; i < allIds.length; i += 50) {
        const slice = allIds.slice(i, i + 50);
        const { scores: out } = await scoreLeadsCall({
          data: { leadIds: slice, context: scoringContext.trim() },
        });
        setScores((prev) => {
          const next = new Map(prev);
          out.forEach((s) => next.set(s.leadId, { score: s.score, reasoning: s.reasoning }));
          return next;
        });
        done += out.length;
      }
      toast.success(`Scored ${done} leads`);
    } catch (e: any) {
      toast.error(e.message ?? "Scoring failed");
    } finally {
      setScoringBusy(false);
    }
  };

  const eligibleIds = useMemo(
    () =>
      Array.from(picked).filter((id) => {
        if (minScore <= 0) return true;
        const s = scores.get(id);
        return !!s && s.score >= minScore;
      }),
    [picked, scores, minScore],
  );


  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-background px-8 py-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People Search</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} contacts in your database
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={!hasSelection}>
                <Sparkles className="mr-2 h-4 w-4" /> Actions
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <ListPlus className="mr-2 h-4 w-4" /> Add to List
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCampaignOpen(true)}>
                <Send className="mr-2 h-4 w-4" /> Add to Campaign
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            disabled={exportBusy || (total === 0 && !hasSelection)}
            onClick={exportCsv}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportBusy ? "Exporting…" : "Export"}
          </Button>
          <Button variant="outline" size="sm" onClick={saveSearch}>
            <Save className="mr-2 h-4 w-4" /> Save search
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 shrink-0 overflow-y-auto border-r bg-background p-5">
          <div className="mb-4 flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span className="text-sm font-medium">Filters</span>
            {activeChips.length > 0 && (
              <button
                onClick={clear}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-5">
            <Field
              icon={<Briefcase className="h-3.5 w-3.5" />}
              label="Job title"
              placeholder="e.g. VP of Sales"
              value={draft.title}
              onChange={(v) => setDraft({ ...draft, title: v })}
            />
            <Field
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Company"
              placeholder="e.g. Acme Corp"
              value={draft.company}
              onChange={(v) => setDraft({ ...draft, company: v })}
            />
            <Field
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Location"
              placeholder="city, state or country"
              value={draft.location}
              onChange={(v) => setDraft({ ...draft, location: v })}
            />
            <Field
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Industry"
              placeholder="e.g. Software"
              value={draft.industry}
              onChange={(v) => setDraft({ ...draft, industry: v })}
            />

            <div className="space-y-2 pt-2">
              <Toggle
                label="Has phone number"
                checked={draft.hasPhone}
                onChange={(v) => setDraft({ ...draft, hasPhone: v })}
              />
              <Toggle
                label="Has email"
                checked={draft.hasEmail}
                onChange={(v) => setDraft({ ...draft, hasEmail: v })}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={apply}>
                <Search className="mr-2 h-4 w-4" /> Apply
              </Button>
            </div>
          </div>

          <div className="mt-6 rounded-md border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">AI lead scoring</span>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Tell the AI what you're selling and who you want. It'll score each lead 0–100 on buying likelihood.
            </p>
            <Textarea
              rows={4}
              value={scoringContext}
              onChange={(e) => setScoringContext(e.target.value)}
              placeholder="e.g. We sell AI contact-center software to mid-market companies (200-5000 employees) with large customer support teams. Looking for VP/Dir of CX, Support, or Ops."
              className="text-xs"
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={scorePageLeads}
                disabled={scoringBusy || rows.length === 0}
              >
                {scoringBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                Score page
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={scoreSelectedLeads}
                disabled={scoringBusy || !hasSelection}
              >
                Score selected
              </Button>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Min score for campaign</span>
                <span className="font-medium">{minScore === 0 ? "Any" : `${minScore}+`}</span>
              </div>
              <Slider
                value={[minScore]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => setMinScore(v[0] ?? 0)}
              />
              {hasSelection && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {eligibleIds.length.toLocaleString()} of {picked.size.toLocaleString()} selected pass the threshold.
                </p>
              )}
            </div>
          </div>
        </aside>


        <section className="flex-1 overflow-y-auto">
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
              {activeChips.map((k) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {k}: {String(filters[k])}
                  <button
                    onClick={() => {
                      const next = { ...filters, [k]: typeof filters[k] === "boolean" ? false : "" } as Filters;
                      setFilters(next);
                      setDraft(next);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {hasSelection && (
            <div className="flex items-center justify-between border-b bg-primary/5 px-6 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{picked.size.toLocaleString()} leads selected</span>
                <span className="text-muted-foreground">
                  · selection persists across pages
                </span>
              </div>
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            </div>
          )}

          <div className="p-6">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">
                      <Popover open={selectMenuOpen} onOpenChange={(o) => { setSelectMenuOpen(o); if (!o) setAdvancedMode(false); }}>
                        <PopoverTrigger asChild>
                          <button className="flex items-center gap-1 rounded hover:bg-accent px-1 py-0.5">
                            <Checkbox
                              checked={allPageChecked ? true : somePageChecked ? "indeterminate" : false}
                              onCheckedChange={() => {}}
                              onClick={(e) => e.preventDefault()}
                            />
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-1">
                          {!advancedMode ? (
                            <div className="flex flex-col">
                              <MenuItem onClick={selectThisPage}>Select this page</MenuItem>
                              <MenuItem onClick={selectAllMatching} disabled={bulkBusy}>
                                {bulkBusy ? "Selecting…" : `Select all leads${total ? ` (${total.toLocaleString()})` : ""}`}
                              </MenuItem>
                              <MenuItem onClick={() => setAdvancedMode(true)}>Advanced Selection</MenuItem>
                              <MenuItem onClick={clearSelection}>Clear selection</MenuItem>
                            </div>
                          ) : (
                            <div className="space-y-2 p-2">
                              <Label className="text-xs">Select number of leads</Label>
                              <Input
                                type="number"
                                min={1}
                                max={MAX_BULK}
                                value={advancedN}
                                onChange={(e) => setAdvancedN(e.target.value)}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" className="flex-1" onClick={() => setAdvancedMode(false)}>
                                  Back
                                </Button>
                                <Button size="sm" className="flex-1" onClick={applyAdvanced} disabled={bulkBusy}>
                                  {bulkBusy ? "…" : "Apply Selection"}
                                </Button>
                              </div>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-20">Score</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Contact</TableHead>
                  </TableRow>

                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        No leads match your filters.
                      </TableCell>
                    </TableRow>
                  ) : (

                    rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(r)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={picked.has(r.id)}
                            onCheckedChange={(v) => {
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell>
                          <ScoreBadge info={scores.get(r.id)} />
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-sm">
                          {r.title || "—"}
                        </TableCell>

                        <TableCell className="max-w-[220px] truncate text-sm">
                          {r.org_name || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[r.city, r.state].filter(Boolean).join(", ") || r.country || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1.5 text-muted-foreground">
                            {r.email && <Mail className="h-3.5 w-3.5" />}
                            {r.phone && <Phone className="h-3.5 w-3.5" />}
                            {r.linkedin_url && <Linkedin className="h-3.5 w-3.5" />}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isFetching ? "Loading…" : `Page ${page + 1} of ${totalPages.toLocaleString()}`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <AddToListDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        leadIds={Array.from(picked)}
        onAdded={() => setPicked(new Set())}
      />
      <AddToListDialog
        mode="campaign"
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        leadIds={Array.from(picked)}
        leadScores={
          new Map(
            Array.from(picked).map((id) => [id, scores.get(id)?.score ?? null] as const),
          )
        }
        onAdded={() => setPicked(new Set())}
      />




      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {[selected.first_name, selected.last_name].filter(Boolean).join(" ") || "Lead"}
                </SheetTitle>
                <SheetDescription>{selected.title}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 px-4 pb-6 text-sm">
                <Section title="Company">
                  <div className="font-medium">{selected.org_name || "—"}</div>
                  {selected.org_industry && (
                    <div className="text-muted-foreground">{selected.org_industry}</div>
                  )}
                  {selected.org_employee_count && (
                    <div className="text-muted-foreground">{selected.org_employee_count} employees</div>
                  )}
                  {selected.org_description && (
                    <p className="mt-2 line-clamp-6 whitespace-pre-line text-muted-foreground">
                      {selected.org_description}
                    </p>
                  )}
                </Section>
                <Section title="Location">
                  {[selected.city, selected.state, selected.country].filter(Boolean).join(", ") || "—"}
                </Section>
                <Section title="Contact">
                  <div className="space-y-1.5">
                    {selected.email && (
                      <Row icon={<Mail className="h-3.5 w-3.5" />} value={selected.email} href={`mailto:${selected.email}`} />
                    )}
                    {selected.phone && (
                      <Row icon={<Phone className="h-3.5 w-3.5" />} value={selected.phone} href={`tel:${selected.phone}`} />
                    )}
                    {selected.linkedin_url && (
                      <Row
                        icon={<Linkedin className="h-3.5 w-3.5" />}
                        value="LinkedIn profile"
                        href={selected.linkedin_url.startsWith("http") ? selected.linkedin_url : `https://${selected.linkedin_url}`}
                      />
                    )}
                    {selected.org_website_url && (
                      <Row
                        icon={<Globe className="h-3.5 w-3.5" />}
                        value={selected.org_website_url}
                        href={selected.org_website_url.startsWith("http") ? selected.org_website_url : `https://${selected.org_website_url}`}
                      />
                    )}
                  </div>
                </Section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MenuItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Field({
  icon, label, placeholder, value, onChange,
}: { icon: React.ReactNode; label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ icon, value, href }: { icon: React.ReactNode; value: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-foreground hover:underline"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </a>
  );
}

function ScoreBadge({ info }: { info: ScoreInfo | undefined }) {
  if (!info) return <span className="text-xs text-muted-foreground">—</span>;
  const { score, reasoning } = info;
  const tone =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : score >= 65
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      title={reasoning}
      className={`inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded-full border px-2 text-xs font-semibold ${tone}`}
    >
      {score}
    </span>
  );
}

