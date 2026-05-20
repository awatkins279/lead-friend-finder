import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

import {
  createScoringJob as createScoringJobFn,
  processNextBatch as processNextBatchFn,
  getJobSnapshot as getJobSnapshotFn,
  cancelScoringJob as cancelScoringJobFn,
} from "@/lib/scoring-jobs.functions";
import { fetchMatchingIdsBulk } from "@/lib/leads-bulk.functions";

type Signal = { label: string; verdict: "strong" | "partial" | "weak" | "unknown"; note: string };
type ScoreInfo = {
  score: number;
  reasoning: string;
  signals: Signal[];
  strengths: string[];
  gaps: string[];
};


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
  // Heavy/detail-only fields — only present after lazy-loading in the side sheet
  org_description?: string | null;
  org_website_url?: string | null;
  org_industry?: string | null;
  org_employee_count?: string | null;
};

// Columns rendered in the table (fast path)
const LIST_COLS =
  "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name";
// Extra columns only needed in the detail sheet
const DETAIL_COLS =
  "org_description,org_website_url,org_industry,org_employee_count";

type Filters = {
  name: string;
  titles: string[];
  company: string;
  location: string;
  industry: string;
  companySize: string[];
  hasPhone: boolean;
  hasEmail: boolean;
};

const EMPTY: Filters = {
  name: "",
  titles: [],
  company: "",
  location: "",
  industry: "",
  companySize: [],
  hasPhone: false,
  hasEmail: false,
};

// Maps user-facing size bucket → raw strings present in org_employee_count.
// Source data uses many notations (commas, "to" vs "+"), so we enumerate.
const SIZE_BUCKETS: Record<string, string[]> = {
  "1-10": ["1", "1 to 10", "2 to 10"],
  "11-25": ["11 to 25", "11 to 50"],
  "26-50": ["26 to 50", "11 to 50"],
  "51-100": ["51 to 100", "51 to 200"],
  "101-250": ["101 to 250", "51 to 200", "201 to 500"],
  "251-500": ["251 to 500", "201 to 500"],
  "501-1000": ["501 to 1000", "501 to 1,000"],
  "1001-2500": ["1001 to 5000", "1,001 to 5,000"],
  "2501-5000": ["1001 to 5000", "1,001 to 5,000"],
  "5000+": ["5001 to 10000", "5,001 to 10,000", "10000+", "10001+", "10,001+"],
};

const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "1-10", label: "1-10" },
  { value: "11-25", label: "11-25" },
  { value: "26-50", label: "26-50" },
  { value: "51-100", label: "51-100" },
  { value: "101-250", label: "101-250" },
  { value: "251-500", label: "251-500" },
  { value: "501-1000", label: "501-1,000" },
  { value: "1001-2500", label: "1,001-2,500" },
  { value: "2501-5000", label: "2,501-5,000" },
  { value: "5000+", label: "5,000+" },
];

const PAGE_SIZE = 25;
const MAX_BULK = 50000;

function escapeForOr(v: string) {
  // PostgREST .or() uses commas as separators; escape them in user input.
  return v.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function applyFilters<T extends { select: any; ilike: any; or: any; not: any; neq: any; in: any }>(q: T, f: Filters): T {
  let r: any = q;
  const titles = (f.titles ?? []).map((t) => t.trim()).filter(Boolean);
  if (titles.length === 1) {
    r = r.ilike("title", `%${titles[0]}%`);
  } else if (titles.length > 1) {
    const expr = titles.map((t) => `title.ilike.%${escapeForOr(t)}%`).join(",");
    r = r.or(expr);
  }
  if (f.company.trim()) r = r.ilike("org_name", `%${f.company.trim()}%`);
  if (f.industry.trim()) r = r.ilike("org_industry", `%${f.industry.trim()}%`);
  if (f.location.trim()) {
    const t = f.location.trim();
    r = r.or(`city.ilike.%${t}%,state.ilike.%${t}%,country.ilike.%${t}%`);
  }
  const sizes = f.companySize ?? [];
  if (sizes.length > 0) {
    const raw = Array.from(
      new Set(sizes.flatMap((s) => SIZE_BUCKETS[s] ?? [])),
    );
    if (raw.length > 0) r = r.in("org_employee_count", raw);
  }
  if (f.hasPhone) r = r.not("phone", "is", null).neq("phone", "");
  if (f.hasEmail) r = r.not("email", "is", null).neq("email", "");
  return r;
}

async function fetchMatchingIds(filters: Filters, limit: number): Promise<string[]> {
  // One server round trip; the worker keyset-paginates locally over a fast
  // PG connection. Avoids dozens of cross-internet round trips from the
  // browser, which was the main source of slowness for large selections.
  const res = await fetchMatchingIdsBulk({ data: { filters, limit } });
  return res.ids;
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<{
    totalBatches: number;
    completedBatches: number;
    failedBatches: number;
    scoredLeads: number;
    totalLeads: number;
    status: string;
  } | null>(null);
  const scoringBusy = jobProgress?.status === "running";
  
  const createScoringJobCall = useServerFn(createScoringJobFn);
  const processNextBatchCall = useServerFn(processNextBatchFn);
  const getJobSnapshotCall = useServerFn(getJobSnapshotFn);
  const cancelScoringJobCall = useServerFn(cancelScoringJobFn);

  useEffect(() => setPage(0), [filters]);

  const queryKey = useMemo(() => ["leads", filters, page], [filters, page]);

  const { data, isLoading, isFetching } = useQuery({
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryKey,
    queryFn: async () => {
      let q: any = supabase
        .from("leads")
        .select(LIST_COLS, { count: "estimated" });
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
  const activeChips = useMemo(
    () =>
      (Object.keys(filters) as (keyof Filters)[]).filter((k) => {
        const v = filters[k];
        if (Array.isArray(v)) return v.length > 0;
        return typeof v === "string" ? v.trim() !== "" : v === true;
      }),
    [filters],
  );
  const { allPageChecked, somePageChecked } = useMemo(() => {
    if (rows.length === 0) return { allPageChecked: false, somePageChecked: false };
    let all = true;
    let some = false;
    for (const r of rows) {
      if (picked.has(r.id)) some = true;
      else all = false;
    }
    return { allPageChecked: all, somePageChecked: some && !all };
  }, [rows, picked]);

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
      const requested = Math.min(total || MAX_BULK, MAX_BULK);
      const ids = await fetchMatchingIds(filters, requested);
      setPicked(new Set(ids));
      if (ids.length < requested) {
        toast.info(
          `Only ${ids.length.toLocaleString()} leads match your current filters, so all matching leads were selected.`,
        );
      } else {
        toast.success(`${ids.length.toLocaleString()} leads selected`);
      }
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
      if (ids.length < n) {
        toast.info(
          `Only ${ids.length.toLocaleString()} leads match your current filters, so all matching leads were selected.`,
        );
      } else {
        toast.success(`${ids.length.toLocaleString()} leads selected`);
      }
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


  // ---- Background scoring jobs ----
  // Tab-safe: progress is persisted in the DB. Closing the tab pauses;
  // re-opening the page resumes via the localStorage handle.
  const WORKER_COUNT = 20;
  const STORAGE_KEY = "active-scoring-job-id";

  const mergeScoreResults = (
    rows: Array<{ leadId: string; score: number; reasoning: string; signals: any; strengths: any; gaps: any }>,
  ) => {
    if (rows.length === 0) return;
    setScores((prev) => {
      const next = new Map(prev);
      rows.forEach((s) =>
        next.set(s.leadId, {
          score: s.score,
          reasoning: s.reasoning,
          signals: s.signals ?? [],
          strengths: s.strengths ?? [],
          gaps: s.gaps ?? [],
        }),
      );
      return next;
    });
  };

  const cancelTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const runWorkers = async (jobId: string, totalBatches: number) => {
    cancelTokenRef.current = { cancelled: false };
    const token = cancelTokenRef.current;

    const workerLoop = async () => {
      let emptyClaims = 0;
      while (!token.cancelled) {
        try {
          const res = await processNextBatchCall({ data: { jobId } });
          if (res.claimed) {
            emptyClaims = 0;
            if (res.results && res.results.length > 0) mergeScoreResults(res.results);
            if (res.job) {
              setJobProgress({
                totalBatches: res.job.total_batches,
                completedBatches: res.job.completed_batches,
                failedBatches: res.job.failed_batches,
                scoredLeads: res.job.scored_leads,
                totalLeads: res.job.total_leads,
                status: res.job.status,
              });
              if (res.job.status !== "running") break;
            }
            continue;
          }
          // No batch claimed. If job is finished, stop. Otherwise siblings may
          // still re-queue failures into 'retry' — wait and poll a few times.
          if (res.job && res.job.status !== "running") break;
          if (
            res.job &&
            res.job.completed_batches + res.job.failed_batches >= res.job.total_batches
          ) {
            break;
          }
          emptyClaims += 1;
          if (emptyClaims > 20) break; // ~30s of nothing-to-do → bail
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };

    await Promise.all(Array.from({ length: WORKER_COUNT }, () => workerLoop()));

    // Final snapshot to sync counters + status
    try {
      const snap = await getJobSnapshotCall({ data: { jobId } });
      setJobProgress({
        totalBatches: snap.job.total_batches,
        completedBatches: snap.job.completed_batches,
        failedBatches: snap.job.failed_batches,
        scoredLeads: snap.job.scored_leads,
        totalLeads: snap.job.total_leads,
        status: snap.job.status,
      });
      if (snap.job.status !== "running") {
        localStorage.removeItem(STORAGE_KEY);
        setActiveJobId(null);
        if (!token.cancelled) {
          const failed = snap.job.failed_batches;
          if (snap.job.status === "completed") {
            toast.success(`Scored ${snap.job.scored_leads.toLocaleString()} of ${snap.job.total_leads.toLocaleString()} leads`);
          } else if (snap.job.status === "completed_with_errors") {
            toast.warning(`Scored ${snap.job.scored_leads.toLocaleString()} leads — ${failed} batch${failed === 1 ? "" : "es"} failed`);
          }
        }
      }
    } catch {}
  };

  const startScoringJob = async (ids: string[]) => {
    if (!scoringContext.trim() || scoringContext.trim().length < 10) {
      toast.error("Tell the AI what you're selling (min 10 chars)");
      return;
    }
    if (scoringBusy) {
      toast.info("A scoring job is already running");
      return;
    }
    const todo = ids.filter((id) => !scores.has(id));
    if (todo.length === 0) {
      toast.info("All selected leads are already scored");
      return;
    }
    try {
      const { jobId, totalBatches, totalLeads } = await createScoringJobCall({
        data: { leadIds: todo, context: scoringContext.trim() },
      });
      localStorage.setItem(STORAGE_KEY, jobId);
      setActiveJobId(jobId);
      setJobProgress({
        totalBatches,
        completedBatches: 0,
        failedBatches: 0,
        scoredLeads: 0,
        totalLeads,
        status: "running",
      });
      toast.success(`Queued ${totalLeads.toLocaleString()} leads — scoring in background`);
      // fire-and-forget: workers update state as they go
      void runWorkers(jobId, totalBatches);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to start scoring job");
    }
  };

  const scorePageLeads = () => startScoringJob(rows.map((r) => r.id));
  const scoreSelectedLeads = () => startScoringJob(Array.from(picked));

  const cancelScoring = async () => {
    if (!activeJobId) return;
    cancelTokenRef.current.cancelled = true;
    try {
      await cancelScoringJobCall({ data: { jobId: activeJobId } });
    } catch {}
    localStorage.removeItem(STORAGE_KEY);
    setActiveJobId(null);
    setJobProgress((p) => (p ? { ...p, status: "cancelled" } : null));
    toast.info("Scoring cancelled");
  };

  // Resume any active job on mount (e.g. user closed tab mid-run)
  useEffect(() => {
    const jobId = localStorage.getItem(STORAGE_KEY);
    if (!jobId) return;
    (async () => {
      try {
        const snap = await getJobSnapshotCall({ data: { jobId } });
        if (snap.results.length > 0) mergeScoreResults(snap.results);
        setJobProgress({
          totalBatches: snap.job.total_batches,
          completedBatches: snap.job.completed_batches,
          failedBatches: snap.job.failed_batches,
          scoredLeads: snap.job.scored_leads,
          totalLeads: snap.job.total_leads,
          status: snap.job.status,
        });
        if (snap.job.status === "running") {
          setActiveJobId(jobId);
          void runWorkers(jobId, snap.job.total_batches);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);




  const eligibleIds = useMemo(
    () =>
      Array.from(picked).filter((id) => {
        if (minScore <= 0) return true;
        const s = scores.get(id);
        return !!s && s.score >= minScore;
      }),
    [picked, scores, minScore],
  );

  const hasSelection = picked.size > 0;

  // Stable arrays/maps for child dialogs so they don't re-render every keystroke
  const pickedIds = useMemo(() => Array.from(picked), [picked]);
  const campaignLeadScores = useMemo(
    () => new Map(pickedIds.map((id) => [id, scores.get(id)?.score ?? null] as const)),
    [pickedIds, scores],
  );

  // Lazily fetch heavy detail fields only when the side sheet opens
  const { data: selectedDetail } = useQuery({
    enabled: !!selected,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryKey: ["lead-detail", selected?.id],
    queryFn: async () => {
      if (!selected) return null;
      const { data, error } = await supabase
        .from("leads")
        .select(DETAIL_COLS)
        .eq("id", selected.id)
        .maybeSingle();
      if (error) throw error;
      return data as Pick<Lead, "org_description" | "org_website_url" | "org_industry" | "org_employee_count"> | null;
    },
  });
  const selectedFull: Lead | null = selected
    ? { ...selected, ...(selectedDetail ?? {}) }
    : null;


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
            <TitleMultiSelect
              values={draft.titles}
              onChange={(next) => setDraft({ ...draft, titles: next })}
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

            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" /> Company size
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className={draft.companySize.length === 0 ? "text-muted-foreground" : ""}>
                      {draft.companySize.length === 0
                        ? "Any size"
                        : draft.companySize.length === 1
                          ? `${SIZE_OPTIONS.find((o) => o.value === draft.companySize[0])?.label} employees`
                          : `${draft.companySize.length} ranges selected`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-2">
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {SIZE_OPTIONS.map((o) => {
                      const checked = draft.companySize.includes(o.value);
                      return (
                        <label
                          key={o.value}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const next = v
                                ? [...draft.companySize, o.value]
                                : draft.companySize.filter((x) => x !== o.value);
                              setDraft({ ...draft, companySize: next });
                            }}
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </div>
                  {draft.companySize.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, companySize: [] })}
                      className="mt-2 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                    >
                      Clear
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            </div>

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

            {jobProgress && (
              <div className="mt-3 rounded-md border bg-background p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {jobProgress.status === "running" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                    {jobProgress.status === "running"
                      ? "Scoring in background…"
                      : jobProgress.status === "completed"
                        ? "Scoring complete"
                        : jobProgress.status === "completed_with_errors"
                          ? "Done (some errors)"
                          : jobProgress.status === "cancelled"
                            ? "Cancelled"
                            : jobProgress.status}
                  </span>
                  <span className="text-muted-foreground">
                    {jobProgress.scoredLeads.toLocaleString()} / {jobProgress.totalLeads.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${jobProgress.totalBatches === 0 ? 0 : Math.round(((jobProgress.completedBatches + jobProgress.failedBatches) / jobProgress.totalBatches) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {jobProgress.completedBatches + jobProgress.failedBatches} / {jobProgress.totalBatches} batches
                    {jobProgress.failedBatches > 0 ? ` · ${jobProgress.failedBatches} failed` : ""}
                  </span>
                  {jobProgress.status === "running" && activeJobId && (
                    <button onClick={cancelScoring} className="text-destructive hover:underline">
                      Cancel
                    </button>
                  )}
                </div>
                {jobProgress.status === "running" && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Safe to close the tab — progress is saved.</p>
                )}
              </div>
            )}


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
              {activeChips.map((k) => {
                const v = filters[k];
                const display = Array.isArray(v) ? v.join(", ") : String(v);
                const emptyVal: any = Array.isArray(v) ? [] : typeof v === "boolean" ? false : "";
                return (
                  <Badge key={k} variant="secondary" className="gap-1">
                    {k}: {display}
                    <button
                      onClick={() => {
                        const next = { ...filters, [k]: emptyVal } as Filters;
                        setFilters(next);
                        setDraft(next);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
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
        leadIds={pickedIds}
        onAdded={() => setPicked(new Set())}
      />
      <AddToListDialog
        mode="campaign"
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        leadIds={pickedIds}
        leadScores={campaignLeadScores}
        onAdded={() => setPicked(new Set())}
      />




      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedFull && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {[selectedFull.first_name, selectedFull.last_name].filter(Boolean).join(" ") || "Lead"}
                </SheetTitle>
                <SheetDescription>{selectedFull.title}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 px-4 pb-6 text-sm">
                {(() => {
                  const info = scores.get(selectedFull.id);
                  return info ? (
                    <Section title="AI IPP analysis">
                      <div className="-mx-1 rounded-md border">
                        <IppBreakdown info={info} />
                      </div>
                    </Section>
                  ) : (
                    <Section title="AI IPP analysis">
                      <p className="text-xs text-muted-foreground">
                        Not scored yet. Run "Score this page" or "Score selected" to get an in-depth fit breakdown.
                      </p>
                    </Section>
                  );
                })()}
                <Section title="Company">
                  <div className="font-medium">{selectedFull.org_name || "—"}</div>
                  {selectedFull.org_industry && (
                    <div className="text-muted-foreground">{selectedFull.org_industry}</div>
                  )}
                  {selectedFull.org_employee_count && (
                    <div className="text-muted-foreground">{selectedFull.org_employee_count} employees</div>
                  )}
                  {selectedFull.org_description && (
                    <p className="mt-2 line-clamp-6 whitespace-pre-line text-muted-foreground">
                      {selectedFull.org_description}
                    </p>
                  )}
                </Section>
                <Section title="Location">
                  {[selectedFull.city, selectedFull.state, selectedFull.country].filter(Boolean).join(", ") || "—"}
                </Section>
                <Section title="Contact">
                  <div className="space-y-1.5">
                    {selectedFull.email && (
                      <Row icon={<Mail className="h-3.5 w-3.5" />} value={selectedFull.email} href={`mailto:${selectedFull.email}`} />
                    )}
                    {selectedFull.phone && (
                      <Row icon={<Phone className="h-3.5 w-3.5" />} value={selectedFull.phone} href={`tel:${selectedFull.phone}`} />
                    )}
                    {selectedFull.linkedin_url && (
                      <Row
                        icon={<Linkedin className="h-3.5 w-3.5" />}
                        value="LinkedIn profile"
                        href={selectedFull.linkedin_url.startsWith("http") ? selectedFull.linkedin_url : `https://${selectedFull.linkedin_url}`}
                      />
                    )}
                    {selectedFull.org_website_url && (
                      <Row
                        icon={<Globe className="h-3.5 w-3.5" />}
                        value={selectedFull.org_website_url}
                        href={selectedFull.org_website_url.startsWith("http") ? selectedFull.org_website_url : `https://${selectedFull.org_website_url}`}
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

const COMMON_TITLES = [
  "CEO", "Chief Executive Officer", "COO", "Chief Operating Officer", "CFO", "Chief Financial Officer",
  "CTO", "Chief Technology Officer", "CIO", "Chief Information Officer", "CMO", "Chief Marketing Officer",
  "CRO", "Chief Revenue Officer", "CHRO", "Chief People Officer", "CPO", "Chief Product Officer",
  "Chief of Staff", "Founder", "Co-Founder", "Owner", "President", "Vice President",
  "VP of Sales", "VP of Marketing", "VP of Engineering", "VP of Product", "VP of Operations",
  "VP of Finance", "VP of People", "VP of Customer Success", "VP of Business Development",
  "SVP", "EVP", "Managing Director", "General Manager", "Director",
  "Director of Sales", "Director of Marketing", "Director of Engineering", "Director of Operations",
  "Director of Product", "Director of Finance", "Director of HR", "Director of Customer Success",
  "Head of Sales", "Head of Marketing", "Head of Growth", "Head of Engineering", "Head of Product",
  "Head of Operations", "Head of People", "Head of Partnerships",
  "Sales Manager", "Marketing Manager", "Product Manager", "Engineering Manager", "Operations Manager",
  "Account Manager", "Account Executive", "Sales Development Representative", "SDR", "BDR",
  "Business Development Representative", "Customer Success Manager", "Project Manager", "Program Manager",
  "Marketing Director", "Brand Manager", "Content Manager", "SEO Manager", "Growth Marketing Manager",
  "Digital Marketing Manager", "Digital Marketing Specialist", "Marketing Specialist", "Marketing Coordinator",
  "Social Media Manager", "Demand Generation Manager", "Performance Marketing Manager",
  "Software Engineer", "Senior Software Engineer", "Staff Engineer", "Principal Engineer",
  "Frontend Engineer", "Backend Engineer", "Full Stack Engineer", "DevOps Engineer", "Data Engineer",
  "Data Scientist", "Data Analyst", "Machine Learning Engineer", "AI Engineer", "Solutions Architect",
  "Sales Engineer", "Solutions Engineer", "Technical Account Manager",
  "Recruiter", "Talent Acquisition Manager", "HR Manager", "HR Business Partner",
  "Financial Analyst", "Controller", "Accountant", "Operations Analyst",
  "Realtor", "Real Estate Agent", "Broker", "Loan Officer", "Mortgage Broker",
  "Attorney", "Lawyer", "Paralegal", "Partner", "Associate",
  "Physician", "Doctor", "Dentist", "Nurse Practitioner", "Practice Manager",
  "Consultant", "Senior Consultant", "Principal Consultant", "Partner Consultant",
  "Insurance Agent", "Financial Advisor", "Wealth Manager",
];

function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  const idx = t.indexOf(q);
  if (idx >= 0) return 300 - idx;
  // subsequence match
  let ti = 0;
  let matched = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    while (ti < t.length && t[ti] !== ch) ti++;
    if (ti >= t.length) return 0;
    matched++;
    ti++;
  }
  return matched > 0 ? 50 : 0;
}

function TitleMultiSelect({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = useMemo(() => {
    const selected = new Set(values.map((v) => v.toLowerCase()));
    const scored = COMMON_TITLES
      .filter((t) => !selected.has(t.toLowerCase()))
      .map((t) => ({ t, s: fuzzyScore(query.trim(), t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.t);
    return scored;
  }, [query, values]);

  const addTitle = (t: string) => {
    const v = t.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onChange([...values, v]);
    setQuery("");
  };

  const removeTitle = (t: string) => {
    onChange(values.filter((x) => x !== t));
  };

  const showCustomAdd =
    query.trim().length > 0 &&
    !suggestions.some((s) => s.toLowerCase() === query.trim().toLowerCase()) &&
    !values.some((v) => v.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Briefcase className="h-3.5 w-3.5" /> Job title
        </Label>
        {values.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setQuery("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="relative">
        <div
          className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring"
          onClick={() => setOpen(true)}
        >
          {values.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTitle(t);
                }}
                aria-label={`Remove ${t}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                e.preventDefault();
                addTitle(suggestions[0] ?? query);
              } else if (e.key === "Backspace" && !query && values.length > 0) {
                removeTitle(values[values.length - 1]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={values.length === 0 ? "Search job titles…" : ""}
            className="flex-1 min-w-[8ch] bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {open && (suggestions.length > 0 || showCustomAdd) && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTitle(s);
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {s}
              </button>
            ))}
            {showCustomAdd && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTitle(query);
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
              >
                Add "{query.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
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

const verdictBadge: Record<Signal["verdict"], string> = {
  strong: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  weak: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  unknown: "bg-muted text-muted-foreground border-border",
};
const verdictDot: Record<Signal["verdict"], string> = {
  strong: "bg-emerald-500",
  partial: "bg-amber-500",
  weak: "bg-rose-500",
  unknown: "bg-muted-foreground/40",
};

function ScoreBadge({ info }: { info: ScoreInfo | undefined }) {
  if (!info) return <span className="text-xs text-muted-foreground">—</span>;
  const { score } = info;
  const tone =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : score >= 65
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex h-6 min-w-[2.5rem] cursor-pointer items-center justify-center gap-1 rounded-full border px-2 text-xs font-semibold transition-colors hover:opacity-90 ${tone}`}
        >
          {score}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-96 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <IppBreakdown info={info} />
      </PopoverContent>
    </Popover>
  );
}

function IppBreakdown({ info }: { info: ScoreInfo }) {
  const { score, reasoning, signals, strengths, gaps } = info;
  return (
    <div className="max-h-[28rem] space-y-4 overflow-y-auto p-4 text-sm">
      <div>
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            IPP fit
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {score}
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
        </div>
        {reasoning && (
          <p className="mt-1 text-xs text-muted-foreground">{reasoning}</p>
        )}
      </div>

      {signals.length > 0 && (
        <div className="space-y-2">
          {signals.map((s, i) => (
            <div key={i} className="rounded-md border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{s.label}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictBadge[s.verdict]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${verdictDot[s.verdict]}`} />
                  {s.verdict}
                </span>
              </div>
              {s.note && <p className="mt-1 text-[11px] text-muted-foreground">{s.note}</p>}
            </div>
          ))}
        </div>
      )}

      {(strengths.length > 0 || gaps.length > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                Why they fit
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Concerns
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {gaps.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {signals.length === 0 && strengths.length === 0 && gaps.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No detailed breakdown — re-score this lead to get an in-depth IPP analysis.
        </p>
      )}
    </div>
  );
}


