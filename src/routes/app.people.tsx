import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLeadQuery } from "@/lib/lead-filters";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Link2 as Linkedin,
  Mail,
  Phone,
  Globe,
  Save,
  ChevronDown,
  Download,
  Sparkles,
  ListPlus,
  Send,
  Upload,
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
  finalizeScoringJob as finalizeScoringJobFn,
} from "@/lib/scoring-jobs.functions";
import { fetchMatchingIdsBulk } from "@/lib/leads-bulk.functions";
import {
  verifyLeadEmailsBatch as verifyLeadEmailsBatchFn,
  loadLeadVerifications as loadLeadVerificationsFn,
} from "@/lib/verify.functions";
import { ShieldCheck } from "lucide-react";
import { importLeadsForScoring as importLeadsForScoringFn } from "@/lib/lead-import.functions";

type VerificationStatus = "deliverable" | "risky" | "invalid" | "disposable" | "unknown";

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
  profile_pic: string | null;
  // Heavy/detail-only fields — only present after lazy-loading in the side sheet
  org_description?: string | null;
  org_website_url?: string | null;
  org_industry?: string | null;
  org_employee_count?: string | null;
};

// Deterministic placeholder headshot (Pravatar — free, no API key).
// Seeded by name+id so the same person always gets the same face.
function avatarUrl(first: string | null, last: string | null, id: string, size = 160): string {
  const seed = encodeURIComponent(
    `${(first ?? "").trim()}-${(last ?? "").trim()}-${id}`.toLowerCase(),
  );
  return `https://i.pravatar.cc/${size}?u=${seed}`;
}

// Columns rendered in the table (fast path)
const LIST_COLS =
  "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name,profile_pic";
// Extra columns only needed in the detail sheet
const DETAIL_COLS = "org_description,org_website_url,org_industry,org_employee_count";

type Filters = {
  name: string;
  titles: string[];
  company: string;
  locations: string[];
  industry: string;
  companySize: string[];
  hasPhone: boolean;
  hasEmail: boolean;
};

const EMPTY: Filters = {
  name: "",
  titles: [],
  company: "",
  locations: [],
  industry: "",
  companySize: [],
  hasPhone: false,
  hasEmail: false,
};

// Company-size dropdown options. The raw value → bucket mapping lives in the
// shared SIZE_BUCKETS (lead-filters.ts) so the list and bulk-select agree.
const SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "1-10", label: "1-10" },
  { value: "11-25", label: "11-25" },
  { value: "26-50", label: "26-50" },
  { value: "51-100", label: "51-100" },
  { value: "101-250", label: "101-250" },
  { value: "251-500", label: "251-500" },
  { value: "501-1000", label: "501-1,000" },
  { value: "1001-5000", label: "1,001-5,000" },
  { value: "5000+", label: "5,000+" },
];

const PAGE_SIZE = 25;
const MAX_BULK = 50000;
const BULK_ID_PAGE_SIZE = 2500;

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  firstname: "first_name",
  first: "first_name",
  lastname: "last_name",
  last: "last_name",
  emailaddress: "email",
  jobtitle: "title",
  companyname: "company",
  organization: "company",
  companyindustry: "industry",
  companysize: "company_size",
  employeecount: "company_size",
  phonenumber: "phone",
  linkedin: "linkedin_url",
  linkedinurl: "linkedin_url",
  website: "company_website",
  companywebsite: "company_website",
  description: "company_description",
  // Location — common header variants that must land in city/state/country,
  // otherwise Zod silently drops them and location search finds nothing.
  city: "city",
  location: "city",
  state: "state",
  stateprovince: "state",
  region: "state",
  province: "state",
  country: "country",
  nation: "country",
};

function mapImportedRows(records: string[][]): Array<Record<string, string>> {
  if (records.length < 2) return [];
  const headers = records[0].map((header) => {
    const normalized = header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return (
      IMPORT_HEADER_ALIASES[normalized] ??
      header
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
    );
  });
  return records
    .slice(1)
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])),
    );
}

async function parseLeadFile(file: File): Promise<Array<Record<string, string>>> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  const records = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return mapImportedRows(records.map((row) => row.map((value) => String(value ?? ""))));
}

function escapeForOr(v: string) {
  // PostgREST .or() uses commas as separators; escape them in user input.
  return v.replace(/,/g, "\\,").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function applyFilters<T extends { select: any; ilike: any; or: any; not: any; neq: any; in: any }>(
  q: T,
  f: Filters,
): T {
  // Single source of truth — shared with the bulk select-all server function.
  return buildLeadQuery(q, f) as T;
}

// Single round-trip — server returns IDs capped at MAX_BULK + 1 so we can
// detect "too many to select" without paginating ourselves.
async function fetchMatchingIds(
  filters: Filters,
  limit: number,
): Promise<{ ids: string[]; capped: boolean }> {
  return fetchMatchingIdsBulk({ data: { filters, limit } });
}

function PeoplePage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [scoredCampaignOpen, setScoredCampaignOpen] = useState(false);

  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [advancedN, setAdvancedN] = useState("1000");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSelectedCount, setBulkSelectedCount] = useState(0);
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

  // Per-user email verification cache (lead_id -> status). Persists across
  // sessions on the server (lead_verifications table) but loaded lazily here.
  const [verifications, setVerifications] = useState<Map<string, VerificationStatus>>(new Map());
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [importBusy, setImportBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const createScoringJobCall = useServerFn(createScoringJobFn);
  const processNextBatchCall = useServerFn(processNextBatchFn);
  const getJobSnapshotCall = useServerFn(getJobSnapshotFn);
  const cancelScoringJobCall = useServerFn(cancelScoringJobFn);
  const finalizeScoringJobCall = useServerFn(finalizeScoringJobFn);
  const verifyLeadEmailsBatchCall = useServerFn(verifyLeadEmailsBatchFn);
  const loadLeadVerificationsCall = useServerFn(loadLeadVerificationsFn);
  const importLeadsForScoringCall = useServerFn(importLeadsForScoringFn);

  useEffect(() => setPage(0), [filters]);

  const queryKey = useMemo(() => ["leads", filters, page], [filters, page]);

  const { data, isLoading, isFetching } = useQuery({
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryKey,
    queryFn: async () => {
      const hasFilters =
        (filters.name ?? "").trim() !== "" ||
        (filters.titles ?? []).length > 0 ||
        (filters.company ?? "").trim() !== "" ||
        (filters.locations ?? []).length > 0 ||
        (filters.industry ?? "").trim() !== "" ||
        (filters.companySize ?? []).length > 0 ||
        !!filters.hasPhone ||
        !!filters.hasEmail;

      let q: any = supabase.from("leads").select(LIST_COLS);
      q = applyFilters(q, filters);
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.order("id", { ascending: true }).range(from, to);

      // When filters are active, fetch matching IDs (capped at MAX_BULK + 1)
      // in parallel with the visible page. We use ids.length as the displayed
      // count AND as the selection source — one round-trip serves both, and
      // the LIMIT lets PG stop scanning as soon as the cap is hit instead of
      // counting the whole filtered set (which used to time out).
      let countPromise: Promise<{ count: number; capped: boolean; ids: string[] }>;
      if (hasFilters) {
        countPromise = fetchMatchingIdsBulk({
          data: { filters, limit: MAX_BULK + 1 },
        })
          .then((r) => ({ count: r.ids.length, capped: r.capped, ids: r.ids }))
          .catch(() => ({ count: 0, capped: false, ids: [] }));
      } else {
        countPromise = Promise.resolve(supabase.rpc("leads_total_estimate")).then(
          (r: any) => ({ count: Number(r.data ?? 0), capped: false, ids: [] }),
        );
      }

      const [rowsRes, countRes] = await Promise.all([q, countPromise]);
      if (rowsRes.error) throw rowsRes.error;
      return {
        rows: (rowsRes.data ?? []) as Lead[],
        count: countRes.count,
        capped: countRes.capped,
        matchingIds: countRes.ids,
        hasFilters,
      };
    },
  });




  const total = data?.count ?? 0;
  const totalIsCapped = data?.capped ?? false;
  const totalIsExact = !!data?.hasFilters && !totalIsCapped;
  const matchingIds = data?.matchingIds ?? [];
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
  const matchingCountLabel =
    totalIsCapped ? `${MAX_BULK.toLocaleString()}+` : total.toLocaleString();
  const matchingCountPrefix = totalIsExact || totalIsCapped ? "" : "About ";
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
    if (totalIsCapped) {
      toast.error(
        `More than ${MAX_BULK.toLocaleString()} leads match. Narrow your filters or use Advanced Selection.`,
      );
      return;
    }
    // We already fetched the matching IDs alongside the page query — selection
    // is just turning that cached array into a Set. No second round-trip.
    if (matchingIds.length === 0) {
      toast.info("No leads match these filters.");
      setSelectMenuOpen(false);
      return;
    }
    setPicked(new Set(matchingIds));
    toast.success(`${matchingIds.length.toLocaleString()} leads selected`);
    setSelectMenuOpen(false);
    setAdvancedMode(false);
  };

  const applyAdvanced = async () => {
    const n = parseInt(advancedN, 10) || 0;
    if (n <= 0) {
      toast.error("Enter a positive number");
      return;
    }
    if (n > MAX_BULK) {
      toast.error("Cannot select more than 50,000 leads");
      return;
    }
    setBulkBusy(true);
    setBulkSelectedCount(0);
    try {
      const res = await fetchMatchingIds(filters, n);
      const selectedIds = res.ids.slice(0, n);
      setPicked(new Set(selectedIds));
      if (selectedIds.length === 0) {
        toast.info("No leads match these filters.");
      } else if (selectedIds.length < n) {
        toast.info(
          `Only ${selectedIds.length.toLocaleString()} leads match your current filters, so all matching leads were selected.`,
        );
      } else {
        toast.success(`${selectedIds.length.toLocaleString()} leads selected`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to select");
    } finally {
      setBulkBusy(false);
      setBulkSelectedCount(0);
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
        const res = await fetchMatchingIds(filters, MAX_BULK);
        ids = res.ids;
      }
      const all: Lead[] = [];
      const cols =
        "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name,profile_pic,org_description,org_website_url,org_industry,org_employee_count";
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
  // Tab-safe: progress is persisted in the database and the scheduled worker
  // continues after the tab closes. Browser workers accelerate active sessions.
  const WORKER_COUNT = 4;
  const STORAGE_KEY = "active-scoring-job-id";
  // Shared cooldown for all workers — set when the AI gateway returns 429 so
  // workers slow down together instead of hammering the rate limit.
  const cooldownUntilRef = useRef(0);
  const cooldownStepRef = useRef(250); // ms; grows 250 → 500 → 1000 → 2000 → 4000

  const mergeScoreResults = useCallback(
    (
      rows: Array<{
        leadId: string;
        score: number;
        reasoning: string;
        signals: any;
        strengths: any;
        gaps: any;
      }>,
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
    },
    [],
  );

  const cancelTokenRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const workerRunIdRef = useRef(0);
  // Ensures the terminal (completed/failed) toast fires once per run, even though
  // several workers plus the final reconciliation all call syncJobSnapshot.
  const terminalHandledRef = useRef(0);

  const syncJobSnapshot = useCallback(
    async (
      jobId: string,
      runId: number,
      token: { cancelled: boolean },
      includeResults = false,
    ) => {
      const snap = await getJobSnapshotCall({ data: { jobId, includeResults } });
      if (workerRunIdRef.current !== runId) return snap;

      if (snap.results.length > 0) mergeScoreResults(snap.results);
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
        if (!token.cancelled && terminalHandledRef.current !== runId) {
          terminalHandledRef.current = runId;
          const failed = snap.job.failed_batches;
          if (snap.job.status === "completed") {
            toast.success(
              `Scored ${snap.job.scored_leads.toLocaleString()} of ${snap.job.total_leads.toLocaleString()} leads`,
            );
          } else if (snap.job.status === "completed_with_errors") {
            toast.warning(
              `Scored ${snap.job.scored_leads.toLocaleString()} of ${snap.job.total_leads.toLocaleString()} leads — ${failed} batch${failed === 1 ? "" : "es"} failed. Re-select the unscored leads and run scoring again to finish them.`,
            );
          } else if (snap.job.status === "failed") {
            toast.error(
              `Scoring stopped after ${snap.job.scored_leads.toLocaleString()} of ${snap.job.total_leads.toLocaleString()} leads. Your completed scores were kept; select the remaining leads and try again.`,
            );
          }
        }
      }

      return snap;
    },
    [getJobSnapshotCall, mergeScoreResults],
  );

  const runWorkers = async (jobId: string, totalBatches: number) => {
    cancelTokenRef.current = { cancelled: false };
    const token = cancelTokenRef.current;
    const runId = ++workerRunIdRef.current;

    const progressTimer = setInterval(async () => {
      if (token.cancelled || workerRunIdRef.current !== runId) return;
      try {
        await syncJobSnapshot(jobId, runId, token);
      } catch (error) {
        console.error("Failed to poll scoring progress", error);
      }
    }, 1500);

    const workerLoop = async () => {
      let emptyClaims = 0;
      while (!token.cancelled && workerRunIdRef.current === runId) {
        try {
          // Respect shared cooldown if the gateway is rate-limiting us.
          const wait = cooldownUntilRef.current - Date.now();
          if (wait > 0) {
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }

          const res = await processNextBatchCall({ data: { jobId } });
          if (res.claimed) {
            emptyClaims = 0;
            if (res.results && res.results.length > 0) mergeScoreResults(res.results);
            // Decay cooldown step after a successful pull
            cooldownStepRef.current = Math.max(250, cooldownStepRef.current / 2);
            // If any batch in this fan-out hit a rate-limit, back off briefly.
            if (res.error && /rate limit|429/i.test(res.error)) {
              cooldownUntilRef.current = Date.now() + cooldownStepRef.current;
              cooldownStepRef.current = Math.min(5000, cooldownStepRef.current * 2);
            }
            continue;
          }

          const snap = await syncJobSnapshot(jobId, runId, token);
          if (snap.job.status !== "running") break;

          const accounted = snap.job.completed_batches + snap.job.failed_batches;
          if (accounted >= totalBatches) {
            try {
              await finalizeScoringJobCall({ data: { jobId } });
            } catch (error) {
              console.error("Failed to finalize completed scoring job", error);
            }
            const afterFinalize = await syncJobSnapshot(jobId, runId, token);
            if (afterFinalize.job.status !== "running") break;
          }

          emptyClaims += 1;

          await new Promise((r) => setTimeout(r, 1500));
        } catch (error: any) {
          console.error("Scoring worker loop failed", error);
          const msg = String(error?.message ?? error);
          if (/rate limit|429/i.test(msg)) {
            cooldownUntilRef.current = Date.now() + cooldownStepRef.current;
            cooldownStepRef.current = Math.min(5000, cooldownStepRef.current * 2);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };

    await Promise.all(Array.from({ length: WORKER_COUNT }, () => workerLoop()));
    clearInterval(progressTimer);

    if (workerRunIdRef.current !== runId) return;

    try {
      await finalizeScoringJobCall({ data: { jobId } });
    } catch (error) {
      console.error("Failed to finalize scoring job after workers exited", error);
    }

    try {
      // Authoritative full reconciliation. The per-batch worker fetches order by
      // updated_at, so under concurrent workers some freshly-scored rows can be
      // missed in the live merge. Load ALL results from the DB once the run ends
      // so the UI shows exactly what was scored (and downstream campaign/verify
      // operate on the complete set).
      await syncJobSnapshot(jobId, runId, token, true);
    } catch (error) {
      console.error("Failed to fetch final scoring snapshot", error);
    }
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
      toast.success(`Queued ${totalLeads.toLocaleString()} leads — fast scoring in background`);
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
    workerRunIdRef.current += 1;
    try {
      await cancelScoringJobCall({ data: { jobId: activeJobId } });
    } catch (error) {
      console.error("Failed to cancel scoring job", error);
    }
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
        const snap = await getJobSnapshotCall({ data: { jobId, includeResults: true } });
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
      } catch (error) {
        console.error("Failed to resume scoring job", error);
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

  // All scored leads that pass the current threshold (independent of selection).
  // Used by the "Add qualified to campaign" shortcut under the scoring panel.
  const scoredEligibleIds = useMemo(() => {
    const out: string[] = [];
    scores.forEach((s, id) => {
      if (s.score >= Math.max(minScore, 1)) out.push(id);
    });
    return out;
  }, [scores, minScore]);
  const scoredEligibleScores = useMemo(
    () => new Map(scoredEligibleIds.map((id) => [id, scores.get(id)?.score ?? null] as const)),
    [scoredEligibleIds, scores],
  );

  // Load cached verifications for newly-scored leads so we don't re-charge
  // for any email the user has already verified in a previous session.
  useEffect(() => {
    const missing = scoredEligibleIds.filter((id) => !verifications.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        // Chunk in 5k to stay under input cap
        for (let i = 0; i < missing.length; i += 5000) {
          const slice = missing.slice(i, i + 5000);
          const { verifications: rows } = await loadLeadVerificationsCall({
            data: { leadIds: slice },
          });
          if (cancelled) return;
          setVerifications((prev) => {
            const next = new Map(prev);
            for (const r of rows as Array<{ lead_id: string; status: string }>) {
              next.set(r.lead_id, r.status as VerificationStatus);
            }
            return next;
          });
        }
      } catch (err) {
        console.warn("Failed to load cached verifications", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoredEligibleIds.length]);

  const unverifiedScoredIds = useMemo(
    () => scoredEligibleIds.filter((id) => !verifications.has(id)),
    [scoredEligibleIds, verifications],
  );

  const deliverableScoredIds = useMemo(
    () => scoredEligibleIds.filter((id) => verifications.get(id) === "deliverable"),
    [scoredEligibleIds, verifications],
  );

  const verifyEmails = async (requestedIds: string[]) => {
    if (verifyBusy) return;
    const ids = requestedIds.filter((id) => !verifications.has(id));
    if (ids.length === 0) {
      toast.info("Those leads have already been verified.");
      return;
    }
    setVerifyBusy(true);
    setVerifyProgress({ done: 0, total: ids.length });
    const BATCH = 50;
    const PARALLEL = 3;
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += BATCH * PARALLEL) {
        const window = ids.slice(i, i + BATCH * PARALLEL);
        const batches: string[][] = [];
        for (let j = 0; j < window.length; j += BATCH) batches.push(window.slice(j, j + BATCH));
        const results = await Promise.all(
          batches.map((leadIds) => verifyLeadEmailsBatchCall({ data: { leadIds } })),
        );
        setVerifications((prev) => {
          const next = new Map(prev);
          for (const r of results) {
            for (const v of r.results) next.set(v.leadId, v.status);
          }
          return next;
        });
        done += window.length;
        setVerifyProgress({ done, total: ids.length });
      }
      toast.success(`Verified ${ids.length.toLocaleString()} emails`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setVerifyBusy(false);
      setVerifyProgress(null);
    }
  };

  const verifyScoredEmails = () => verifyEmails(scoredEligibleIds);
  const verifySelectedEmails = () => verifyEmails(Array.from(picked));

  const keepVerificationResults = (allowed: VerificationStatus[]) => {
    const verifiedSelected = Array.from(picked).filter((id) => verifications.has(id));
    if (verifiedSelected.length === 0) {
      toast.info("Validate the selected emails first.");
      return;
    }
    const allowedSet = new Set(allowed);
    setPicked(
      (previous) =>
        new Set(
          Array.from(previous).filter((id) => allowedSet.has(verifications.get(id) ?? "unknown")),
        ),
    );
    toast.success(
      allowed.length === 1 ? "Kept deliverable emails only" : "Kept deliverable and risky emails",
    );
  };

  const importAndScore = async (file: File) => {
    if (!scoringContext.trim() || scoringContext.trim().length < 10) {
      toast.error("Describe your ideal customer profile before importing");
      return;
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["csv", "tsv", "xlsx", "xls"].includes(extension)) {
      toast.error("Upload a CSV, TSV, or Excel file");
      return;
    }
    if (file.size > 20_000_000) {
      toast.error("Lead files must be 20 MB or smaller");
      return;
    }
    setImportBusy(true);
    try {
      const leads = await parseLeadFile(file);
      if (leads.length === 0) {
        throw new Error("No lead rows were found. Make sure row 1 contains column headers.");
      }
      if (leads.length > 5000) throw new Error("Import up to 5,000 leads at a time");
      const result = await importLeadsForScoringCall({ data: { leads } });
      setPicked(new Set(result.ids));
      toast.success(`Imported ${result.imported.toLocaleString()} leads`);
      await startScoringJob(result.ids);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Lead import failed");
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const hasSelection = picked.size > 0;
  const hasVerifiedSelection = Array.from(picked).some((id) => verifications.has(id));

  // Stable arrays/maps for child dialogs so they don't re-render every keystroke
  const pickedIds = useMemo(() => Array.from(picked), [picked]);
  const campaignLeadScores = useMemo(
    () => new Map(pickedIds.map((id) => [id, scores.get(id)?.score ?? null] as const)),
    [pickedIds, scores],
  );

  useEffect(() => {
    const missing = pickedIds.filter((id) => !verifications.has(id));
    if (missing.length === 0 || pickedIds.length > 1000) return;
    let cancelled = false;
    void (async () => {
      try {
        for (let i = 0; i < missing.length; i += 200) {
          const result = await loadLeadVerificationsCall({
            data: { leadIds: missing.slice(i, i + 200) },
          });
          if (cancelled) return;
          setVerifications((previous) => {
            const next = new Map(previous);
            for (const row of result.verifications as Array<{ lead_id: string; status: string }>) {
              next.set(row.lead_id, row.status as VerificationStatus);
            }
            return next;
          });
        }
      } catch (error) {
        console.warn("Failed to load selected email validations", error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds.join(",")]);

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
      return data as Pick<
        Lead,
        "org_description" | "org_website_url" | "org_industry" | "org_employee_count"
      > | null;
    },
  });
  const selectedFull: Lead | null = selected ? { ...selected, ...(selectedDetail ?? {}) } : null;

  // ===== Filter chip helpers =====
  const chipBase =
    "group flex h-[58px] min-w-[150px] flex-col justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]";

  const industryActive = !!draft.industry;
  const sizeActive = draft.companySize.length > 0;
  const locationActive = draft.locations.length > 0;
  const titleActive = draft.titles.length > 0;
  const nameActive = !!draft.name || !!draft.company;

  const sizeLabel =
    draft.companySize.length === 0
      ? "Any size"
      : draft.companySize.length === 1
        ? (SIZE_OPTIONS.find((o) => o.value === draft.companySize[0])?.label ?? "—")
        : `${draft.companySize.length} selected`;

  // ===== Right-rail AI gauge math =====
  const scoreVals = Array.from(scores.values()).map((s) => s.score);
  const totalScore = scoreVals.reduce((a, b) => a + b, 0);
  const maxScore = Math.max(scoreVals.length * 100, 1);
  const gaugePct = scoreVals.length === 0 ? 0 : totalScore / maxScore;
  const aboveThreshold = scoreVals.filter((s) => s >= minScore).length;

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-4 overflow-hidden">
      {/* MAIN COLUMN */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">People Search</h1>
            <p className="mt-1 text-sm text-muted-foreground font-mono-num">
              {matchingCountPrefix}{matchingCountLabel} matching contacts · 25 shown per page
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5 backdrop-blur"
              onClick={saveSearch}
            >
              <Save className="mr-2 h-4 w-4" /> Save Search
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-white/10 bg-white/5 backdrop-blur"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="19" cy="12" r="1.5" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setAddOpen(true)} disabled={!hasSelection}>
                  <ListPlus className="mr-2 h-4 w-4" /> Add to List
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCampaignOpen(true)} disabled={!hasSelection}>
                  <Send className="mr-2 h-4 w-4" /> Add to Campaign
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={exportCsv}
                  disabled={exportBusy || (total === 0 && !hasSelection)}
                >
                  <Download className="mr-2 h-4 w-4" /> {exportBusy ? "Exporting…" : "Export CSV"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Horizontal filter chip row */}
        <div className="flex flex-wrap items-stretch gap-2.5">
          {/* Industry */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={chipBase}>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Company Industry
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-sm text-foreground">
                  <span className="truncate">
                    {industryActive ? draft.industry : "Any industry"}
                  </span>
                  {industryActive && (
                    <X
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = { ...filters, industry: "" };
                        setFilters(next);
                        setDraft(next);
                      }}
                    />
                  )}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <AutocompleteField
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Industry"
                placeholder="e.g. Software"
                value={draft.industry}
                onChange={(v) => {
                  const next = { ...draft, industry: v };
                  setDraft(next);
                  setFilters(next);
                }}
                options={COMMON_INDUSTRIES}
              />
            </PopoverContent>
          </Popover>

          {/* Company Size */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={chipBase}>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Company Size
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-sm text-foreground">
                  <span className="truncate">{sizeLabel}</span>
                  {sizeActive && (
                    <X
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = { ...filters, companySize: [] };
                        setFilters(next);
                        setDraft(next);
                      }}
                    />
                  )}
                </span>
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
                          const nextFilters = { ...draft, companySize: next };
                          setDraft(nextFilters);
                          setFilters(nextFilters);
                        }}
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {/* Location */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={chipBase}>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Location
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-sm text-foreground">
                  <span className="truncate">
                    {locationActive
                      ? draft.locations.length === 1
                        ? draft.locations[0]
                        : `${draft.locations.length} locations`
                      : "Anywhere"}
                  </span>
                  {locationActive && (
                    <X
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = { ...filters, locations: [] };
                        setFilters(next);
                        setDraft(next);
                      }}
                    />
                  )}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <MultiTagSelect
                values={draft.locations}
                onChange={(next) => {
                  const nextFilters = { ...draft, locations: next };
                  setDraft(nextFilters);
                  setFilters(nextFilters);
                }}
                options={COMMON_LOCATIONS}
                label="Location"
                icon={<MapPin className="h-3.5 w-3.5" />}
                placeholder="Search city, state or country…"
              />
            </PopoverContent>
          </Popover>

          {/* Title */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={chipBase}>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Title
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-sm text-foreground">
                  <span className="truncate">
                    {titleActive
                      ? draft.titles.length === 1
                        ? draft.titles[0]
                        : `${draft.titles.length} titles`
                      : "Any title"}
                  </span>
                  {titleActive && (
                    <X
                      className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = { ...filters, titles: [] };
                        setFilters(next);
                        setDraft(next);
                      }}
                    />
                  )}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
              <MultiTagSelect
                values={draft.titles}
                onChange={(next) => {
                  const nextFilters = { ...draft, titles: next };
                  setDraft(nextFilters);
                  setFilters(nextFilters);
                }}
                options={COMMON_TITLES}
                label="Job title"
                icon={<Briefcase className="h-3.5 w-3.5" />}
                placeholder="Search job titles…"
              />
            </PopoverContent>
          </Popover>

          {/* More Filters (name/company/has email/phone) */}
          <Popover>
            <PopoverTrigger asChild>
              <button className={`${chipBase} flex-row items-center gap-2`}>
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">More Filters</span>
                {(nameActive || draft.hasEmail || draft.hasPhone) && (
                  <span className="ml-1 rounded-full bg-[var(--gradient-aurora)] px-1.5 text-[10px] font-semibold text-white">
                    {[nameActive, draft.hasEmail, draft.hasPhone].filter(Boolean).length}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4 p-4">
              <Field
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Company"
                placeholder="e.g. Acme Corp"
                value={draft.company}
                onChange={(v) => {
                  const next = { ...draft, company: v };
                  setDraft(next);
                  setFilters(next);
                }}
              />
              <div className="space-y-2 pt-1">
                <Toggle
                  label="Has phone number"
                  checked={draft.hasPhone}
                  onChange={(v) => {
                    const next = { ...draft, hasPhone: v };
                    setDraft(next);
                    setFilters(next);
                  }}
                />
                <Toggle
                  label="Has email"
                  checked={draft.hasEmail}
                  onChange={(v) => {
                    const next = { ...draft, hasEmail: v };
                    setDraft(next);
                    setFilters(next);
                  }}
                />
              </div>
              {activeChips.length > 0 && (
                <button
                  onClick={clear}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear all filters
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Search + View row */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onBlur={apply}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder="Search by first or last name…"
              className="h-11 rounded-xl border-white/10 bg-white/[0.03] pl-10 placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        {/* Selection bar */}
        {hasSelection && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[oklch(0.70_0.18_290/0.08)] px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{picked.size.toLocaleString()} leads selected</span>
              <span className="text-muted-foreground">· selection persists across pages</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={verifySelectedEmails}
                disabled={verifyBusy}
              >
                {verifyBusy ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1 h-3 w-3" />
                )}
                Validate selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => keepVerificationResults(["deliverable"])}
                disabled={!hasVerifiedSelection}
              >
                Keep deliverable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => keepVerificationResults(["deliverable", "risky"])}
                disabled={!hasVerifiedSelection}
              >
                Keep deliverable + risky
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="glass-panel-strong flex-1 overflow-hidden rounded-2xl">
          <div className="h-full overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="w-14 pl-6">
                    <Popover
                      open={selectMenuOpen}
                      onOpenChange={(o) => {
                        setSelectMenuOpen(o);
                        if (!o) setAdvancedMode(false);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <div className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5">
                          <span
                            aria-hidden="true"
                            className="grid h-4 w-4 shrink-0 place-content-center rounded-sm border border-primary bg-transparent text-[10px] leading-none text-primary"
                          >
                            {allPageChecked ? "✓" : somePageChecked ? "–" : ""}
                          </span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-64 p-1">
                        {!advancedMode ? (
                          <div className="flex flex-col">
                            <MenuItem onClick={selectThisPage}>Select this page</MenuItem>
                            <MenuItem onClick={selectAllMatching} disabled={bulkBusy}>
                              {bulkBusy
                                ? `Selecting${bulkSelectedCount ? ` ${bulkSelectedCount.toLocaleString()}` : ""}…`
                                : `Select matching (${matchingCountLabel})`}
                            </MenuItem>
                            <MenuItem onClick={() => setAdvancedMode(true)}>
                              Advanced Selection
                            </MenuItem>
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
                              <Button
                                size="sm"
                                variant="ghost"
                                className="flex-1"
                                onClick={() => setAdvancedMode(false)}
                              >
                                Back
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={applyAdvanced}
                                disabled={bulkBusy}
                              >
                                {bulkBusy ? "…" : "Apply Selection"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Title
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Company
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Location
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    Email status
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">
                    AI Score
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      No leads match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className={`cursor-pointer border-white/5 transition hover:bg-white/[0.03] ${selected?.id === r.id ? "bg-white/[0.04]" : ""}`}
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="pl-6" onClick={(e) => e.stopPropagation()}>
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
                        <div className="flex items-center gap-3">
                          <div className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 shadow-[0_4px_12px_-4px_oklch(0.70_0.18_290/0.4)] ring-1 ring-white/10">
                            <img
                              src={r.profile_pic || avatarUrl(r.first_name, r.last_name, r.id)}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(e) => {
                                const img = e.currentTarget as HTMLImageElement;
                                const fallback = avatarUrl(r.first_name, r.last_name, r.id);
                                if (img.src !== fallback) img.src = fallback;
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">
                              {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                            </span>
                            {r.linkedin_url && (
                              <Linkedin className="h-3 w-3 text-muted-foreground" />
                            )}
                            {r.email && <Mail className="h-3 w-3 text-muted-foreground" />}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm">
                        {r.title || "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {r.org_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {[r.city, r.state].filter(Boolean).join(", ") || r.country || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <VerificationBadge status={verifications.get(r.id)} hasEmail={!!r.email} />
                      </TableCell>
                      <TableCell>
                        <ScoreBadge info={scores.get(r.id)} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {isFetching ? "Loading…" : `Showing page ${page + 1} of ${totalPages.toLocaleString()}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/5"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* RIGHT RAIL — desktop only */}
      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
        {/* AI Scoring panel */}
        <div className="glass-panel-strong rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[oklch(0.78_0.16_210)]" />
              <span className="text-sm font-medium">AI Scoring</span>
            </div>
          </div>

          {/* Circular gauge */}
          <div className="relative mx-auto mb-4 h-40 w-40">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <defs>
                <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="oklch(0.70 0.18 290)" />
                  <stop offset="100%" stopColor="oklch(0.78 0.16 210)" />
                </linearGradient>
              </defs>
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="oklch(1 0 0 / 0.06)"
                strokeWidth="8"
              />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="url(#gauge-grad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${gaugePct * 314} 314`}
                style={{ filter: "drop-shadow(0 0 8px oklch(0.78 0.16 210 / 0.5))" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono-num text-2xl font-bold tracking-tight">
                {totalScore.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / {maxScore.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Total Score
              </div>
            </div>
          </div>

          {/* ICP textarea */}
          <Textarea
            rows={3}
            value={scoringContext}
            onChange={(e) => setScoringContext(e.target.value)}
            placeholder="Describe your ideal customer profile…"
            className="border-white/10 bg-white/[0.03] text-xs"
          />

          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importAndScore(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full border-dashed border-white/15 bg-white/[0.03]"
            disabled={importBusy || scoringBusy || scoringContext.trim().length < 10}
            onClick={() => importInputRef.current?.click()}
          >
            {importBusy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3 w-3" />
            )}
            Upload lead file and score
          </Button>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {scoringContext.trim().length < 10
              ? "Describe your ideal customer above to enable file scoring."
              : "CSV, TSV, or Excel. Supports name, email, title, company, industry, location, phone, and LinkedIn columns. Up to 5,000 rows."}
          </p>

          {/* Threshold */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Scoring Threshold</span>
              <span className="font-mono-num font-semibold">{minScore}</span>
            </div>
            <Slider
              value={[minScore]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => setMinScore(v[0] ?? 0)}
            />
            <p className="mt-2 font-mono-num text-xs text-muted-foreground">
              {aboveThreshold} leads above threshold
            </p>
          </div>

          {/* Actions */}
          <div className="mt-4 space-y-2">
            <Button
              size="sm"
              className="w-full bg-[var(--gradient-aurora)] text-white shadow-[var(--shadow-glow)] hover:opacity-90"
              onClick={hasSelection ? scoreSelectedLeads : scorePageLeads}
              disabled={scoringBusy || (hasSelection ? picked.size === 0 : rows.length === 0)}
            >
              {scoringBusy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              {hasSelection ? `Score ${picked.size.toLocaleString()} selected` : "Score this page"}
            </Button>
            {!hasSelection && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Tip: click the checkbox header above the table to select all matching leads, then
                score them all at once.
              </p>
            )}
            {scoredEligibleIds.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-white/10 bg-white/5"
                  onClick={verifyScoredEmails}
                  disabled={verifyBusy || unverifiedScoredIds.length === 0}
                >
                  {verifyBusy ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1 h-3 w-3" />
                  )}
                  {unverifiedScoredIds.length === 0
                    ? `All ${scoredEligibleIds.length.toLocaleString()} verified`
                    : `Verify ${unverifiedScoredIds.length.toLocaleString()} email${unverifiedScoredIds.length === 1 ? "" : "s"} (1 credit each)`}
                </Button>
                {verifyProgress && (
                  <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px]">
                    <div className="flex justify-between">
                      <span>Verifying…</span>
                      <span className="font-mono-num text-muted-foreground">
                        {verifyProgress.done.toLocaleString()} /{" "}
                        {verifyProgress.total.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full bg-[var(--gradient-aurora)] transition-all"
                        style={{
                          width: `${verifyProgress.total === 0 ? 0 : Math.round((verifyProgress.done / verifyProgress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-white/10 bg-white/5"
                  onClick={() => setScoredCampaignOpen(true)}
                >
                  <Send className="mr-1 h-3 w-3" />
                  Add {scoredEligibleIds.length.toLocaleString()} to campaign
                  {deliverableScoredIds.length > 0 &&
                    deliverableScoredIds.length !== scoredEligibleIds.length && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ({deliverableScoredIds.length.toLocaleString()} deliverable)
                      </span>
                    )}
                </Button>
              </>
            )}
          </div>

          {jobProgress && (
            <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {jobProgress.status === "running" && (
                    <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                  )}
                  {jobProgress.status === "running" ? "Scoring…" : jobProgress.status}
                </span>
                <span className="font-mono-num text-muted-foreground">
                  {jobProgress.scoredLeads.toLocaleString()} /{" "}
                  {jobProgress.totalLeads.toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-[var(--gradient-aurora)] transition-all"
                  style={{
                    width: `${jobProgress.totalBatches === 0 ? 0 : Math.round(((jobProgress.completedBatches + jobProgress.failedBatches) / jobProgress.totalBatches) * 100)}%`,
                  }}
                />
              </div>
              {jobProgress.status === "running" && activeJobId && (
                <button
                  onClick={cancelScoring}
                  className="mt-1 text-[10px] text-destructive hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Lead Detail panel */}
        {selectedFull ? (
          <div className="glass-panel-strong rounded-2xl p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/5 shadow-[0_4px_12px_-4px_oklch(0.70_0.18_290/0.5)] ring-1 ring-white/10">
                <img
                  src={
                    selectedFull.profile_pic ||
                    avatarUrl(selectedFull.first_name, selectedFull.last_name, selectedFull.id)
                  }
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    const fallback = avatarUrl(
                      selectedFull.first_name,
                      selectedFull.last_name,
                      selectedFull.id,
                    );
                    if (img.src !== fallback) img.src = fallback;
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate font-semibold">
                    {[selectedFull.first_name, selectedFull.last_name].filter(Boolean).join(" ") ||
                      "Lead"}
                  </div>
                  {scores.get(selectedFull.id) &&
                    scores.get(selectedFull.id)!.score >= minScore && (
                      <span className="rounded-full border border-[oklch(0.78_0.16_210/0.3)] bg-[oklch(0.78_0.16_210/0.1)] px-2 py-0.5 text-[10px] font-medium text-[oklch(0.78_0.16_210)]">
                        High Match
                      </span>
                    )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selectedFull.title || "—"}
                </div>
                {selectedFull.org_name && (
                  <div className="mt-1 truncate text-xs text-foreground">
                    {selectedFull.org_name}
                  </div>
                )}
                {[selectedFull.city, selectedFull.state, selectedFull.country]
                  .filter(Boolean)
                  .join(", ") && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {[selectedFull.city, selectedFull.state, selectedFull.country]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              {(() => {
                const info = scores.get(selectedFull.id);
                return info ? (
                  <div className="-mx-1 overflow-hidden rounded-lg border border-white/10">
                    <IppBreakdown info={info} />
                  </div>
                ) : null;
              })()}

              <Section title="Contact">
                <div className="space-y-1.5 text-xs">
                  {selectedFull.email && (
                    <Row
                      icon={<Mail className="h-3.5 w-3.5" />}
                      value={selectedFull.email}
                      href={`mailto:${selectedFull.email}`}
                    />
                  )}
                  {selectedFull.phone && (
                    <Row
                      icon={<Phone className="h-3.5 w-3.5" />}
                      value={selectedFull.phone}
                      href={`tel:${selectedFull.phone}`}
                    />
                  )}
                  {selectedFull.linkedin_url && (
                    <Row
                      icon={<Linkedin className="h-3.5 w-3.5" />}
                      value="LinkedIn profile"
                      href={
                        selectedFull.linkedin_url.startsWith("http")
                          ? selectedFull.linkedin_url
                          : `https://${selectedFull.linkedin_url}`
                      }
                    />
                  )}
                  {selectedFull.org_website_url && (
                    <Row
                      icon={<Globe className="h-3.5 w-3.5" />}
                      value={selectedFull.org_website_url}
                      href={
                        selectedFull.org_website_url.startsWith("http")
                          ? selectedFull.org_website_url
                          : `https://${selectedFull.org_website_url}`
                      }
                    />
                  )}
                </div>
              </Section>

              {(selectedFull.org_industry ||
                selectedFull.org_employee_count ||
                selectedFull.org_description) && (
                <Section title="Company">
                  {selectedFull.org_industry && (
                    <div className="text-xs text-muted-foreground">{selectedFull.org_industry}</div>
                  )}
                  {selectedFull.org_employee_count && (
                    <div className="text-xs text-muted-foreground">
                      {selectedFull.org_employee_count} employees
                    </div>
                  )}
                  {selectedFull.org_description && (
                    <p className="mt-2 line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                      {selectedFull.org_description}
                    </p>
                  )}
                </Section>
              )}
            </div>
          </div>
        ) : (
          <div className="glass-panel-strong flex flex-col items-center justify-center gap-2 rounded-2xl p-6 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-white/5">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Select a lead to view details</p>
          </div>
        )}
      </aside>

      {/* Mobile slide-over for lead detail */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md lg:hidden">
          {selectedFull && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {[selectedFull.first_name, selectedFull.last_name].filter(Boolean).join(" ") ||
                    "Lead"}
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
                  ) : null;
                })()}
                <Section title="Company">
                  <div className="font-medium">{selectedFull.org_name || "—"}</div>
                  {selectedFull.org_industry && (
                    <div className="text-muted-foreground">{selectedFull.org_industry}</div>
                  )}
                  {selectedFull.org_employee_count && (
                    <div className="text-muted-foreground">
                      {selectedFull.org_employee_count} employees
                    </div>
                  )}
                </Section>
                <Section title="Contact">
                  <div className="space-y-1.5">
                    {selectedFull.email && (
                      <Row
                        icon={<Mail className="h-3.5 w-3.5" />}
                        value={selectedFull.email}
                        href={`mailto:${selectedFull.email}`}
                      />
                    )}
                    {selectedFull.phone && (
                      <Row
                        icon={<Phone className="h-3.5 w-3.5" />}
                        value={selectedFull.phone}
                        href={`tel:${selectedFull.phone}`}
                      />
                    )}
                    {selectedFull.linkedin_url && (
                      <Row
                        icon={<Linkedin className="h-3.5 w-3.5" />}
                        value="LinkedIn profile"
                        href={
                          selectedFull.linkedin_url.startsWith("http")
                            ? selectedFull.linkedin_url
                            : `https://${selectedFull.linkedin_url}`
                        }
                      />
                    )}
                  </div>
                </Section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
        leadVerifications={verifications}
        onAdded={() => setPicked(new Set())}
      />
      <AddToListDialog
        mode="campaign"
        open={scoredCampaignOpen}
        onOpenChange={setScoredCampaignOpen}
        leadIds={scoredEligibleIds}
        leadScores={scoredEligibleScores}
        leadVerifications={verifications}
        onAdded={() => {
          setScores((previous) => {
            const next = new Map(previous);
            scoredEligibleIds.forEach((id) => next.delete(id));
            return next;
          });
        }}
      />
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
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
  icon,
  label,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

const COMMON_INDUSTRIES = [
  "Software",
  "Information Technology",
  "Computer Software",
  "Internet",
  "SaaS",
  "Artificial Intelligence",
  "Cybersecurity",
  "Cloud Computing",
  "Fintech",
  "E-commerce",
  "Financial Services",
  "Banking",
  "Insurance",
  "Investment Management",
  "Venture Capital",
  "Private Equity",
  "Accounting",
  "Real Estate",
  "Commercial Real Estate",
  "Construction",
  "Architecture & Planning",
  "Healthcare",
  "Hospital & Health Care",
  "Medical Devices",
  "Pharmaceuticals",
  "Biotechnology",
  "Mental Health Care",
  "Telemedicine",
  "Education",
  "Higher Education",
  "E-Learning",
  "EdTech",
  "Marketing & Advertising",
  "Public Relations",
  "Market Research",
  "Media Production",
  "Publishing",
  "Broadcast Media",
  "Entertainment",
  "Music",
  "Film",
  "Retail",
  "Consumer Goods",
  "Apparel & Fashion",
  "Cosmetics",
  "Food & Beverages",
  "Restaurants",
  "Hospitality",
  "Hotels",
  "Travel",
  "Leisure & Tourism",
  "Manufacturing",
  "Industrial Automation",
  "Automotive",
  "Aerospace",
  "Defense",
  "Logistics & Supply Chain",
  "Transportation",
  "Warehousing",
  "Maritime",
  "Energy",
  "Oil & Gas",
  "Renewable Energy",
  "Utilities",
  "Mining & Metals",
  "Agriculture",
  "Farming",
  "Environmental Services",
  "Waste Management",
  "Legal Services",
  "Law Practice",
  "Management Consulting",
  "Business Consulting",
  "Staffing & Recruiting",
  "Human Resources",
  "Professional Training",
  "Telecommunications",
  "Wireless",
  "Semiconductors",
  "Electronics",
  "Government",
  "Non-Profit",
  "Civic & Social Organization",
  "Religious Institutions",
  "Sports",
  "Fitness",
  "Wellness",
  "Beauty",
  "Veterinary",
  "Pet Services",
];

const COMMON_LOCATIONS = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Netherlands",
  "Spain",
  "Italy",
  "Sweden",
  "Ireland",
  "Switzerland",
  "Denmark",
  "Norway",
  "Finland",
  "Belgium",
  "Portugal",
  "Poland",
  "Austria",
  "India",
  "Singapore",
  "United Arab Emirates",
  "Israel",
  "Japan",
  "Brazil",
  "Mexico",
  "New York",
  "New York, NY",
  "San Francisco, CA",
  "Los Angeles, CA",
  "San Diego, CA",
  "Seattle, WA",
  "Portland, OR",
  "Austin, TX",
  "Dallas, TX",
  "Houston, TX",
  "Chicago, IL",
  "Boston, MA",
  "Atlanta, GA",
  "Miami, FL",
  "Orlando, FL",
  "Tampa, FL",
  "Denver, CO",
  "Phoenix, AZ",
  "Las Vegas, NV",
  "Salt Lake City, UT",
  "Washington, DC",
  "Philadelphia, PA",
  "Pittsburgh, PA",
  "Detroit, MI",
  "Minneapolis, MN",
  "Nashville, TN",
  "Charlotte, NC",
  "Raleigh, NC",
  "Columbus, OH",
  "Cleveland, OH",
  "Indianapolis, IN",
  "Kansas City, MO",
  "St. Louis, MO",
  "California",
  "Texas",
  "Florida",
  "New York",
  "Illinois",
  "Pennsylvania",
  "Ohio",
  "Georgia",
  "North Carolina",
  "Michigan",
  "Massachusetts",
  "Washington",
  "Colorado",
  "Toronto",
  "Vancouver",
  "Montreal",
  "Calgary",
  "Ottawa",
  "London",
  "Manchester",
  "Edinburgh",
  "Dublin",
  "Berlin",
  "Munich",
  "Hamburg",
  "Frankfurt",
  "Paris",
  "Lyon",
  "Amsterdam",
  "Rotterdam",
  "Madrid",
  "Barcelona",
  "Lisbon",
  "Milan",
  "Rome",
  "Zurich",
  "Geneva",
  "Stockholm",
  "Copenhagen",
  "Oslo",
  "Helsinki",
  "Sydney",
  "Melbourne",
  "Brisbane",
  "Perth",
  "Dubai",
  "Abu Dhabi",
  "Tel Aviv",
  "Singapore",
  "Hong Kong",
  "Tokyo",
  "Bangalore",
  "Mumbai",
  "Delhi",
];

function AutocompleteField({
  icon,
  label,
  placeholder,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
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
    const q = value.trim();
    if (!q) return [];
    return options
      .map((o) => ({ o, s: fuzzyScore(q, o) }))
      .filter((x) => x.s > 0 && x.o.toLowerCase() !== q.toLowerCase())
      .sort((a, b) => b.s - a.s)
      .slice(0, 10)
      .map((x) => x.o);
  }, [value, options]);

  return (
    <div className="space-y-2" ref={containerRef}>
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </Label>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && suggestions[0]) {
              e.preventDefault();
              onChange(suggestions[0]);
              setOpen(false);
            }
          }}
          placeholder={placeholder}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s);
                  setOpen(false);
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const COMMON_TITLES = [
  "CEO",
  "Chief Executive Officer",
  "COO",
  "Chief Operating Officer",
  "CFO",
  "Chief Financial Officer",
  "CTO",
  "Chief Technology Officer",
  "CIO",
  "Chief Information Officer",
  "CMO",
  "Chief Marketing Officer",
  "CRO",
  "Chief Revenue Officer",
  "CHRO",
  "Chief People Officer",
  "CPO",
  "Chief Product Officer",
  "Chief of Staff",
  "Founder",
  "Co-Founder",
  "Owner",
  "President",
  "Vice President",
  "VP of Sales",
  "VP of Marketing",
  "VP of Engineering",
  "VP of Product",
  "VP of Operations",
  "VP of Finance",
  "VP of People",
  "VP of Customer Success",
  "VP of Business Development",
  "SVP",
  "EVP",
  "Managing Director",
  "General Manager",
  "Director",
  "Director of Sales",
  "Director of Marketing",
  "Director of Engineering",
  "Director of Operations",
  "Director of Product",
  "Director of Finance",
  "Director of HR",
  "Director of Customer Success",
  "Head of Sales",
  "Head of Marketing",
  "Head of Growth",
  "Head of Engineering",
  "Head of Product",
  "Head of Operations",
  "Head of People",
  "Head of Partnerships",
  "Sales Manager",
  "Marketing Manager",
  "Product Manager",
  "Engineering Manager",
  "Operations Manager",
  "Account Manager",
  "Account Executive",
  "Sales Development Representative",
  "SDR",
  "BDR",
  "Business Development Representative",
  "Customer Success Manager",
  "Project Manager",
  "Program Manager",
  "Marketing Director",
  "Brand Manager",
  "Content Manager",
  "SEO Manager",
  "Growth Marketing Manager",
  "Digital Marketing Manager",
  "Digital Marketing Specialist",
  "Marketing Specialist",
  "Marketing Coordinator",
  "Social Media Manager",
  "Demand Generation Manager",
  "Performance Marketing Manager",
  "Software Engineer",
  "Senior Software Engineer",
  "Staff Engineer",
  "Principal Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "DevOps Engineer",
  "Data Engineer",
  "Data Scientist",
  "Data Analyst",
  "Machine Learning Engineer",
  "AI Engineer",
  "Solutions Architect",
  "Sales Engineer",
  "Solutions Engineer",
  "Technical Account Manager",
  "Recruiter",
  "Talent Acquisition Manager",
  "HR Manager",
  "HR Business Partner",
  "Financial Analyst",
  "Controller",
  "Accountant",
  "Operations Analyst",
  "Realtor",
  "Real Estate Agent",
  "Broker",
  "Loan Officer",
  "Mortgage Broker",
  "Attorney",
  "Lawyer",
  "Paralegal",
  "Partner",
  "Associate",
  "Physician",
  "Doctor",
  "Dentist",
  "Nurse Practitioner",
  "Practice Manager",
  "Consultant",
  "Senior Consultant",
  "Principal Consultant",
  "Partner Consultant",
  "Insurance Agent",
  "Financial Advisor",
  "Wealth Manager",
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

function MultiTagSelect({
  values,
  onChange,
  options,
  label,
  icon,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: string[];
  label: string;
  icon: React.ReactNode;
  placeholder: string;
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
    const scored = options.filter((t) => !selected.has(t.toLowerCase()))
      .map((t) => ({ t, s: fuzzyScore(query.trim(), t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.t);
    return scored;
  }, [query, values, options]);

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
          {icon} {label}
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
            placeholder={values.length === 0 ? placeholder : ""}
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
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

function VerificationBadge({
  status,
  hasEmail,
}: {
  status: VerificationStatus | undefined;
  hasEmail: boolean;
}) {
  if (!hasEmail)
    return (
      <Badge variant="outline" className="text-[10px]">
        No email
      </Badge>
    );
  if (!status)
    return (
      <Badge variant="outline" className="text-[10px]">
        Not validated
      </Badge>
    );
  const style =
    status === "deliverable"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : status === "risky"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
        : status === "invalid" || status === "disposable"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
          : "text-muted-foreground";
  return (
    <Badge variant="outline" className={`text-[10px] capitalize ${style}`}>
      {status}
    </Badge>
  );
}

function ScoreBadge({ info }: { info: ScoreInfo | undefined }) {
  if (!info) return <span className="text-xs text-muted-foreground">—</span>;
  const { score } = info;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="group flex w-[140px] items-center gap-2 text-left"
        >
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-[var(--gradient-aurora)] shadow-[0_0_8px_oklch(0.78_0.16_210/0.4)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono-num w-7 text-right text-sm font-semibold text-foreground">
            {score}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0" onClick={(e) => e.stopPropagation()}>
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
        {reasoning && <p className="mt-1 text-xs text-muted-foreground">{reasoning}</p>}
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
                {strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Concerns
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
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
