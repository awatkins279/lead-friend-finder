import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enrichLead } from "@/lib/enrich.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Sparkles, Loader2, Mail, Linkedin, Phone, Copy, Settings2, AlertCircle, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { CampaignConfigDialog, type CampaignConfig } from "@/components/CampaignConfigDialog";

export const Route = createFileRoute("/app/lists/$listId")({
  component: ListDetailPage,
  head: () => ({ meta: [{ title: "Campaign — NexusAi" }] }),
});

type EmailInSequence = {
  step: number;
  subject: string;
  body: string;
  cta: string;
  send_after_days: number;
};

type Row = {
  lead_id: string;
  score: number | null;
  status: string;
  emails: EmailInSequence[] | null;
  email_subject: string | null;
  email_body: string | null;
  research: {
    reasoning?: string;
    pain_points?: string[];
    talking_points?: string[];
    ipp_breakdown?: Array<{
      label: string;
      verdict: "strong" | "partial" | "weak" | "unknown";
      note: string;
    }>;
  } | null;
  lead: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    org_name: string | null;
    org_industry: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
};

// Older enriched rows only have email_subject/email_body (single email). Surface as a 1-step sequence.
function effectiveEmails(r: Row): EmailInSequence[] {
  if (r.emails && r.emails.length > 0) return r.emails;
  if (r.email_subject || r.email_body) {
    return [{
      step: 1,
      subject: r.email_subject ?? "",
      body: r.email_body ?? "",
      cta: "",
      send_after_days: 0,
    }];
  }
  return [];
}

type ListRow = CampaignConfig & { id: string };

function ListDetailPage() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichLead);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    done: number;
    startedAt: number;
    currentName: string;
    cancel: boolean;
  } | null>(null);

  const { data: list, refetch: refetchList } = useQuery({
    queryKey: ["list", listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lists")
        .select(
          "id, name, description, sender_name, sender_title, sender_company, what_selling, key_selling_points, num_emails, word_count, personalization_level, cta_type, extra_instructions",
        )
        .eq("id", listId)
        .maybeSingle();
      if (error) throw error;
      return data as ListRow | null;
    },
  });

  const { data: rows, refetch, isLoading } = useQuery({
    queryKey: ["list-leads", listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
    .select(
          "lead_id, score, status, emails, email_subject, email_body, research, lead:leads(id, first_name, last_name, title, email, phone, linkedin_url, org_name, org_industry, city, state, country)",
        )
        .eq("list_id", listId)
        .order("score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const isConfigured = !!(list?.what_selling && list?.sender_name);

  // Auto-open config the first time a user lands on a brand-new list
  useEffect(() => {
    if (list && !isConfigured && !configOpen) {
      setConfigOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list?.id]);

  const runOne = async (leadId: string) => {
    if (!isConfigured) {
      toast.error("Set up the campaign first");
      setConfigOpen(true);
      return;
    }
    setBusy((p) => new Set(p).add(leadId));
    try {
      await enrichFn({ data: { listId, leadId } });
      qc.invalidateQueries({ queryKey: ["list-leads", listId] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        n.delete(leadId);
        return n;
      });
    }
  };

  const runAll = async () => {
    if (!isConfigured) {
      toast.error("Set up the campaign first");
      setConfigOpen(true);
      return;
    }
    const target = list?.num_emails ?? 4;
    const pending = (rows ?? []).filter(
      (r) => r.status !== "enriched" || (r.emails?.length ?? 0) < target,
    );
    if (pending.length === 0) return toast.info("All prospects already have full sequences");

    const state = { total: pending.length, done: 0, startedAt: Date.now(), currentName: "", cancel: false };
    setProgress({ ...state });

    const CONCURRENCY = 5;
    let cursor = 0;

    const worker = async () => {
      while (true) {
        if (state.cancel) return;
        const i = cursor++;
        if (i >= pending.length) return;
        const r = pending[i];
        const name = [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ") || "lead";
        state.currentName = name;
        setProgress({ ...state });
        try {
          await enrichFn({ data: { listId, leadId: r.lead_id } });
        } catch (e: any) {
          console.error("enrich failed", r.lead_id, e);
        }
        state.done += 1;
        setProgress({ ...state });
        qc.invalidateQueries({ queryKey: ["list-leads", listId] });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()),
    );

    setProgress((p) => (p?.cancel ? null : p));
    if (!state.cancel) {
      toast.success(`Generated sequences for ${state.done} prospect${state.done === 1 ? "" : "s"}`);
      setTimeout(() => setProgress(null), 1500);
    } else {
      toast.info(`Stopped after ${state.done} of ${state.total}`);
    }
  };

  const cancelRunAll = () => {
    setProgress((p) => (p ? { ...p, cancel: true } : p));
  };

  const remove = async (leadId: string) => {
    const { error } = await supabase
      .from("list_leads")
      .delete()
      .eq("list_id", listId)
      .eq("lead_id", leadId);
    if (error) toast.error(error.message);
    else refetch();
  };

  const cfgInitial: CampaignConfig = list
    ? {
        name: list.name ?? "",
        description: list.description,
        sender_name: list.sender_name,
        sender_title: list.sender_title,
        sender_company: list.sender_company,
        what_selling: list.what_selling,
        key_selling_points: list.key_selling_points,
        num_emails: list.num_emails ?? 4,
        word_count: list.word_count ?? 150,
        personalization_level: list.personalization_level ?? "high",
        cta_type: list.cta_type ?? "auto",
        extra_instructions: list.extra_instructions,
      }
    : {
        name: "",
        description: null,
        sender_name: null,
        sender_title: null,
        sender_company: null,
        what_selling: null,
        key_selling_points: null,
        num_emails: 4,
        word_count: 150,
        personalization_level: "high",
        cta_type: "auto",
        extra_instructions: null,
      };

  const enrichedCount = (rows ?? []).filter((r) => r.status === "enriched").length;

  // Re-render every second while running so ETA ticks down
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!progress || progress.done >= progress.total || progress.cancel) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [progress]);

  const isRunning = !!progress && !progress.cancel && progress.done < progress.total;

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b bg-background px-8 py-5">
        <Link to="/app/lists" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All campaigns
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{list?.name ?? "Loading…"}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{(rows ?? []).length} prospects</span>
              <span>·</span>
              <span>{enrichedCount} researched</span>
              {isConfigured && (
                <>
                  <span>·</span>
                  <span>{list?.num_emails} emails</span>
                  <span>·</span>
                  <span>~{list?.word_count} words</span>
                  <span>·</span>
                  <span>{list?.personalization_level} personalization</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setConfigOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Campaign config
            </Button>
            <Button onClick={runAll} disabled={!rows || rows.length === 0 || !isConfigured || isRunning}>
              {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {isRunning ? "Generating…" : "Generate all sequences"}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {!isConfigured && list && (
          <Card className="mb-4 flex items-center gap-3 border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Campaign not configured</p>
              <p className="text-muted-foreground">
                Set up sender info + what you're selling so the AI knows what to write.
              </p>
            </div>
            <Button size="sm" onClick={() => setConfigOpen(true)}>Configure</Button>
          </Card>
        )}

        {progress && (
          <GenerationProgress progress={progress} onCancel={cancelRunAll} />
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No prospects yet. Add some from{" "}
              <Link to="/app/people" className="underline">People Search</Link>.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const name = [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ") || "—";
              const isBusy = busy.has(r.lead_id);
              const eff = effectiveEmails(r);
              const emailCount = eff.length;
              const isLegacy = (!r.emails || r.emails.length === 0) && eff.length > 0;
              return (
                <Card
                  key={r.lead_id}
                  className="flex cursor-pointer items-center gap-4 p-4 transition-shadow hover:shadow-sm"
                  onClick={() => setOpen(r)}
                >
                  <div className="flex w-12 shrink-0 flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                        r.score == null
                          ? "bg-muted text-muted-foreground"
                          : r.score >= 75
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : r.score >= 50
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                      }`}
                    >
                      {r.score ?? "—"}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      {emailCount > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {emailCount} email{emailCount > 1 ? " sequence" : ""}
                        </Badge>
                      )}
                      {isLegacy && (
                        <Badge variant="outline" className="text-[10px]">
                          Regenerate for full sequence
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {r.lead?.title || "—"}{r.lead?.org_name ? ` · ${r.lead.org_name}` : ""}
                    </div>
                    {eff[0]?.subject && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        ✉ {eff[0].subject}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant={r.status === "enriched" ? "outline" : "default"}
                      onClick={() => runOne(r.lead_id)}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                          {r.status === "enriched" ? "Regenerate" : "Generate"}
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r.lead_id)}>
                      Remove
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <LeadDrawer
        listId={listId}
        row={open}
        onClose={() => setOpen(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["list-leads", listId] })}
      />

      {list && (
        <CampaignConfigDialog
          listId={listId}
          initial={cfgInitial}
          open={configOpen}
          onOpenChange={setConfigOpen}
          onSaved={() => refetchList()}
        />
      )}
    </div>
  );
}

function LeadDrawer({
  listId,
  row,
  onClose,
  onChanged,
}: {
  listId: string;
  row: Row | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [emails, setEmails] = useState<EmailInSequence[]>([]);
  const [activeStep, setActiveStep] = useState("1");

  useEffect(() => {
    setEmails(row ? effectiveEmails(row) : []);
    setActiveStep("1");
  }, [row?.lead_id, row?.emails, row?.email_subject, row?.email_body]);

  const updateEmail = (idx: number, patch: Partial<EmailInSequence>) => {
    setEmails((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const saveEmails = async () => {
    if (!row) return;
    const { error } = await supabase
      .from("list_leads")
      .update({
        emails,
        email_subject: emails[0]?.subject ?? "",
        email_body: emails[0]?.body ?? "",
      })
      .eq("list_id", listId)
      .eq("lead_id", row.lead_id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onChanged();
  };

  return (
    <Sheet
      open={!!row}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>
                {[row.lead?.first_name, row.lead?.last_name].filter(Boolean).join(" ") || "Lead"}
              </SheetTitle>
              <SheetDescription>
                {row.lead?.title}{row.lead?.org_name ? ` · ${row.lead.org_name}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6 px-4 pb-8 text-sm">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {row.lead?.email && (
                  <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${row.lead.email}`}>
                    <Mail className="h-3 w-3" /> {row.lead.email}
                  </a>
                )}
                {row.lead?.phone && (
                  <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {row.lead.phone}</span>
                )}
                {row.lead?.linkedin_url && (
                  <a
                    className="inline-flex items-center gap-1 hover:underline"
                    href={row.lead.linkedin_url.startsWith("http") ? row.lead.linkedin_url : `https://${row.lead.linkedin_url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Linkedin className="h-3 w-3" /> LinkedIn
                  </a>
                )}
              </div>

              {row.score != null && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fit score: {row.score}/100
                  </div>
                  {row.research?.reasoning && (
                    <p className="text-muted-foreground">{row.research.reasoning}</p>
                  )}
                </div>
              )}

              {row.research?.pain_points && row.research.pain_points.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Likely pain points
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {row.research.pain_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {emails.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email sequence ({emails.length})
                    </div>
                    <Button size="sm" onClick={saveEmails}>Save changes</Button>
                  </div>

                  <Tabs value={activeStep} onValueChange={setActiveStep}>
                    <TabsList className="w-full justify-start overflow-x-auto">
                      {emails.map((e) => (
                        <TabsTrigger key={e.step} value={String(e.step)}>
                          Email {e.step}
                          {e.send_after_days > 0 && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              +{e.send_after_days}d
                            </span>
                          )}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    {emails.map((e, idx) => (
                      <TabsContent key={e.step} value={String(e.step)} className="space-y-3 pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            CTA: {e.cta || "—"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(`Subject: ${e.subject}\n\n${e.body}`);
                              toast.success("Copied");
                            }}
                          >
                            <Copy className="mr-1.5 h-3 w-3" /> Copy
                          </Button>
                        </div>
                        <Input
                          value={e.subject}
                          onChange={(ev) => updateEmail(idx, { subject: ev.target.value })}
                          placeholder="Subject"
                        />
                        <Textarea
                          rows={14}
                          value={e.body}
                          onChange={(ev) => updateEmail(idx, { body: ev.target.value })}
                          placeholder="Email body"
                          className="font-mono text-xs"
                        />
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
              ) : (
                <Card className="p-4 text-center text-sm text-muted-foreground">
                  Click <strong>Generate</strong> to research this prospect and create a personalized email sequence.
                </Card>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function GenerationProgress({
  progress,
  onCancel,
}: {
  progress: { total: number; done: number; startedAt: number; currentName: string; cancel: boolean };
  onCancel: () => void;
}) {
  const { total, done, startedAt, currentName, cancel } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const elapsed = Date.now() - startedAt;
  const avgMs = done > 0 ? elapsed / done : 0;
  const remaining = total - done;
  const etaMs = avgMs > 0 ? avgMs * remaining : 0;
  const isComplete = done >= total;

  return (
    <Card className="mb-4 overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isComplete ? (
            <Sparkles className="h-5 w-5 text-primary" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          )}
          <div>
            <div className="text-base font-semibold tracking-tight">
              {isComplete
                ? "Sequences generated"
                : cancel
                  ? "Stopping…"
                  : "Generating AI sequences"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isComplete
                ? `Done in ${formatDuration(elapsed)} · ${done} prospect${done === 1 ? "" : "s"}`
                : currentName
                  ? `Working on ${currentName}`
                  : "Warming up…"}
            </div>
          </div>
        </div>
        {!isComplete && !cancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="mr-1 h-3.5 w-3.5" /> Stop
          </Button>
        )}
      </div>

      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">
          {done} / {total} prospects
        </span>
        <span className="text-3xl font-bold tabular-nums tracking-tight text-primary">
          {pct}<span className="text-xl">%</span>
        </span>
      </div>

      <div className="mt-3 h-4 w-full overflow-hidden rounded-full border border-primary/20 bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, minWidth: pct > 0 ? "0.5rem" : 0 }}
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Elapsed: {formatDuration(elapsed)}</span>
        <span>
          {isComplete
            ? "Complete"
            : done === 0
              ? "Estimating ETA…"
              : `ETA ~${formatDuration(etaMs)} · avg ${formatDuration(avgMs)}/lead`}
        </span>
      </div>
    </Card>
  );
}

