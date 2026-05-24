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
import { ArrowLeft, Sparkles, Loader2, Mail, Linkedin, Phone, Copy, Settings2, AlertCircle, X, PhoneCall, Headphones, Maximize2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { CampaignConfigDialog, type CampaignConfig } from "@/components/CampaignConfigDialog";
import { CallingConfigDialog, DEFAULT_CALLING_CONFIG, type CallingConfig } from "@/components/CallingConfigDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateCallScript, getTwilioToken, startCall, startRingOutCall, endCall, type CallScript } from "@/lib/calls.functions";
import { Phone as PhoneIcon, PhoneOff, MicOff, Mic, Bot } from "lucide-react";
import { PROVIDER_SPECS } from "@/components/ProviderAccountDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSdrAgents, assignAgentToList } from "@/lib/sdr.functions";

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
  call_script: CallScript | null;
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

type ListRow = CampaignConfig & { id: string; sdr_agent_id: string | null };

function ListDetailPage() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichLead);
  const genScriptBulkFn = useServerFn(generateCallScript);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [callConfigOpen, setCallConfigOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"email" | "calling">("email");
  const [pendingCallLeadId, setPendingCallLeadId] = useState<string | null>(null);
  const [confirmScripts, setConfirmScripts] = useState(false);
  const [callCfg, setCallCfg] = useState<CallingConfig>(DEFAULT_CALLING_CONFIG);
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
          "id, name, description, sender_name, sender_title, sender_company, what_selling, key_selling_points, num_emails, word_count, personalization_level, cta_type, extra_instructions, sdr_agent_id",
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
          "lead_id, score, status, emails, email_subject, email_body, call_script, research, lead:leads(id, first_name, last_name, title, email, phone, linkedin_url, org_name, org_industry, city, state, country)",
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

  // Load calling config so the dialog opens with existing values
  const loadCallCfg = async () => {
    const { data } = await supabase
      .from("list_call_configs")
      .select("*")
      .eq("list_id", listId)
      .maybeSingle();
    if (data) {
      setCallCfg({
        script_template: data.script_template,
        tone: data.tone,
        objectives: data.objectives,
        objection_notes: data.objection_notes,
        personalization_level: data.personalization_level,
        record_calls: data.record_calls,
        consent_disclaimer: data.consent_disclaimer,
        extra_instructions: data.extra_instructions,
      });
    }
  };
  useEffect(() => { loadCallCfg(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [listId]);


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

  const requestRunAllScripts = async () => {
    const callCfgRow = await supabase
      .from("list_call_configs")
      .select("list_id")
      .eq("list_id", listId)
      .maybeSingle();
    if (!callCfgRow.data) {
      toast.error("Set up the calling config first");
      setCallConfigOpen(true);
      return;
    }
    if (!rows || rows.length === 0) return toast.info("No prospects in this list");
    setConfirmScripts(true);
  };

  const runAllScripts = async () => {
    setConfirmScripts(false);
    const pending = rows ?? [];
    if (pending.length === 0) return;


    const state = { total: pending.length, done: 0, startedAt: Date.now(), currentName: "", cancel: false };
    setProgress({ ...state });

    const CONCURRENCY = 4;
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
          await genScriptBulkFn({ data: { listId, leadId: r.lead_id, force: true } });
        } catch (e: any) {
          console.error("script generation failed", r.lead_id, e);
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
      toast.success(`Generated call scripts for ${state.done} prospect${state.done === 1 ? "" : "s"}`);
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
            <Button variant="outline" onClick={() => setCallConfigOpen(true)}>
              <Headphones className="mr-2 h-4 w-4" /> Calling config
            </Button>
            <Button
              onClick={activeTab === "calling" ? requestRunAllScripts : runAll}
              disabled={!rows || rows.length === 0 || (activeTab === "email" && !isConfigured) || isRunning}
            >
              {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {isRunning
                ? "Generating…"
                : activeTab === "calling"
                  ? "Generate all call scripts"
                  : "Generate all sequences"}
            </Button>
          </div>
        </div>
      </header>

      <SdrAssignBar listId={listId} currentAgentId={list?.sdr_agent_id ?? null} onChanged={() => refetchList()} />



      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "email" | "calling")} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b bg-background px-8">
          <TabsList className="h-11 bg-transparent p-0">
            <TabsTrigger
              value="email"
              className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Mail className="mr-2 h-4 w-4" /> Email outreach
            </TabsTrigger>
            <TabsTrigger
              value="calling"
              className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <PhoneCall className="mr-2 h-4 w-4" /> Cold calling
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="email" className="m-0 flex-1 overflow-y-auto p-8">
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

          {progress && <GenerationProgress progress={progress} onCancel={cancelRunAll} />}

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
                      <IppTagStrip research={r.research} scored={r.score != null} />
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
        </TabsContent>

        <TabsContent value="calling" className="m-0 flex-1 overflow-y-auto">
          {progress && (
            <div className="px-8 pt-6">
              <GenerationProgress progress={progress} onCancel={cancelRunAll} />
            </div>
          )}
          <CallWorkstation
            listId={listId}
            rows={rows ?? []}
            initialActiveLeadId={pendingCallLeadId}
            onConsumedInitial={() => setPendingCallLeadId(null)}
            onOpenConfig={() => setCallConfigOpen(true)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["list-leads", listId] })}
          />
        </TabsContent>
      </Tabs>


      <AlertDialog open={confirmScripts} onOpenChange={setConfirmScripts}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate all call scripts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will rewrite the existing call scripts for all {rows?.length ?? 0} prospects in this campaign using your current Calling config. Any edits made to individual scripts will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runAllScripts}>Rewrite all scripts</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LeadDrawer
        listId={listId}
        row={open}
        onClose={() => setOpen(null)}
        onEnterCallMode={(leadId) => {
          setPendingCallLeadId(leadId);
          setActiveTab("calling");
          setOpen(null);
        }}
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

      <CallingConfigDialog
        listId={listId}
        initial={callCfg}
        open={callConfigOpen}
        onOpenChange={setCallConfigOpen}
        onSaved={loadCallCfg}
      />
    </div>
  );
}

function LeadDrawer({
  listId,
  row,
  onClose,
  onChanged,
  onEnterCallMode,
}: {
  listId: string;
  row: Row | null;
  onClose: () => void;
  onChanged: () => void;
  onEnterCallMode: (leadId: string) => void;
}) {
  const [emails, setEmails] = useState<EmailInSequence[]>([]);
  const [activeStep, setActiveStep] = useState("1");
  const [script, setScript] = useState<CallScript | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const genScriptFn = useServerFn(generateCallScript);

  useEffect(() => {
    setEmails(row ? effectiveEmails(row) : []);
    setActiveStep("1");
    setScript(row?.call_script ?? null);
    
  }, [row?.lead_id, row?.emails, row?.email_subject, row?.email_body, row?.call_script]);

  const genScript = async (force = false) => {
    if (!row) return;
    setScriptBusy(true);
    try {
      const res = await genScriptFn({ data: { listId, leadId: row.lead_id, force } });
      setScript(res.script);
      onChanged();
      toast.success(force ? "Script regenerated" : "Script ready");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate script");
    } finally {
      setScriptBusy(false);
    }
  };


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

              {row.score != null ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fit score: {row.score}/100
                  </div>
                  {row.research?.reasoning && (
                    <p className="text-muted-foreground">{row.research.reasoning}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Not scored yet — click <strong>Generate</strong> to run AI research and IPP analysis.
                </div>
              )}

              <IppBreakdownPanel research={row.research} scored={row.score != null} />


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

              <CallScriptSection
                script={script}
                busy={scriptBusy}
                onGenerate={() => genScript(false)}
                onRegenerate={() => genScript(true)}
                onOpenCallMode={() => row && onEnterCallMode(row.lead_id)}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CallScriptSection({
  script,
  busy,
  onGenerate,
  onRegenerate,
  onOpenCallMode,
}: {
  script: CallScript | null;
  busy: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  onOpenCallMode: () => void;
}) {
  return (
    <div className="space-y-3 border-t pt-6">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cold-call script
        </div>
        <div className="flex gap-2">
          {script && (
            <Button size="sm" variant="default" onClick={onOpenCallMode}>
              <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Open in call mode
            </Button>
          )}
          <Button size="sm" variant={script ? "outline" : "default"} onClick={script ? onRegenerate : onGenerate} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="mr-1.5 h-3.5 w-3.5" />}
            {script ? "Regenerate script" : "Generate script"}
          </Button>
        </div>
      </div>
      {!script ? (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          NEPQ-style script personalized to this prospect using your Calling config.
        </Card>
      ) : (
        <div className="space-y-3 text-sm">
          <ScriptBlock title="Opener" body={script.opener} />
          {script.talk_track?.map((s, i) => (
            <ScriptBlock key={i} title={s.heading} body={s.body} />
          ))}
          <ScriptList title="Problem questions" items={script.problem_questions} />
          <ScriptList title="Solution questions" items={script.solution_questions} />
          <ScriptList title="Consequence questions" items={script.consequence_questions} />
          <ScriptList title="Qualifying questions" items={script.qualifying_questions} />
          <ScriptBlock title="Close" body={script.close} />
          {script.objection_map.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objection handling</div>
              <div className="space-y-1.5">
                {script.objection_map.map((o, i) => (
                  <div key={i} className="rounded-md border p-2.5">
                    <div className="text-xs font-medium">{o.objection}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{o.response}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptBlock({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 leading-relaxed">{body}</p>
    </div>
  );
}

function ScriptList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-1.5">
        {items.map((q, i) => (
          <li key={i} className="rounded-md border bg-muted/30 p-3 leading-relaxed">{q}</li>
        ))}
      </ul>
    </div>
  );
}

function CallModeView({
  open,
  onOpenChange,
  script,
  leadName,
  leadSub,
  phone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  script: CallScript;
  leadName: string;
  leadSub: string;
  phone: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[95vh] w-[95vw] max-w-[1400px] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-baseline justify-between gap-4">
              <span className="text-xl">{leadName}</span>
              <span className="text-sm font-normal text-muted-foreground">{leadSub}</span>
              {phone && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" /> {phone}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <CallSection title="Opener" tone="primary">
                <p className="whitespace-pre-wrap text-lg leading-relaxed">{script.opener}</p>
              </CallSection>
              {script.talk_track?.map((s, i) => (
                <CallSection key={i} title={s.heading}>
                  <p className="whitespace-pre-wrap text-lg leading-relaxed">{s.body}</p>
                </CallSection>
              ))}
              <CallSection title="Problem questions">
                <BigList items={script.problem_questions} />
              </CallSection>
              <CallSection title="Solution questions">
                <BigList items={script.solution_questions} />
              </CallSection>
              <CallSection title="Consequence questions">
                <BigList items={script.consequence_questions} />
              </CallSection>
              <CallSection title="Qualifying questions">
                <BigList items={script.qualifying_questions} />
              </CallSection>
              <CallSection title="Close" tone="primary">
                <p className="text-lg leading-relaxed">{script.close}</p>
              </CallSection>
            </div>
            <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Objection cheat-sheet
              </div>
              {script.objection_map.map((o, i) => (
                <Card key={i} className="p-3">
                  <div className="text-sm font-semibold">{o.objection}</div>
                  <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{o.response}</div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CallSection({ title, tone, children }: { title: string; tone?: "primary"; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone === "primary" ? "text-primary" : "text-muted-foreground"}`}>
        {title}
      </h3>
      <div className={`rounded-lg border p-4 ${tone === "primary" ? "border-primary/40 bg-primary/5" : "bg-card"}`}>
        {children}
      </div>
    </section>
  );
}

function BigList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <ol className="space-y-3 text-lg leading-relaxed">
      {items.map((q, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 text-sm font-semibold text-muted-foreground">{i + 1}.</span>
          <span>{q}</span>
        </li>
      ))}
    </ol>
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


type IppSignal = NonNullable<NonNullable<Row["research"]>["ipp_breakdown"]>[number];

const verdictStyles: Record<IppSignal["verdict"], string> = {
  strong: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  partial: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  weak: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",
  unknown: "bg-muted text-muted-foreground border-border",
};

const verdictDot: Record<IppSignal["verdict"], string> = {
  strong: "bg-emerald-500",
  partial: "bg-amber-500",
  weak: "bg-rose-500",
  unknown: "bg-muted-foreground/40",
};

function IppTagStrip({ research, scored }: { research: Row["research"]; scored: boolean }) {
  const items = research?.ipp_breakdown ?? [];
  if (!scored) {
    return (
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        IPP · Not scored
      </div>
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.slice(0, 5).map((s, i) => (
        <span
          key={i}
          title={s.note}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${verdictStyles[s.verdict]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${verdictDot[s.verdict]}`} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function IppBreakdownPanel({ research, scored }: { research: Row["research"]; scored: boolean }) {
  if (!scored) return null;
  const items = research?.ipp_breakdown ?? [];
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        IPP match breakdown
      </div>
      <div className="space-y-2">
        {items.map((s, i) => (
          <div key={i} className="rounded-md border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{s.label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictStyles[s.verdict]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${verdictDot[s.verdict]}`} />
                {s.verdict}
              </span>
            </div>
            {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cold-call workstation: 2-pane view (lead queue ⇄ active-lead script)
// optimized for speed — phone visible, click-to-call, prev/next, no clutter.
// ---------------------------------------------------------------------------
function CallWorkstation({
  listId,
  rows,
  initialActiveLeadId,
  onConsumedInitial,
  onOpenConfig,
  onChanged,
}: {
  listId: string;
  rows: Row[];
  initialActiveLeadId?: string | null;
  onConsumedInitial?: () => void;
  onOpenConfig: () => void;
  onChanged: () => void;
}) {
  const genScriptFn = useServerFn(generateCallScript);
  const getTokenFn = useServerFn(getTwilioToken);
  const startCallFn = useServerFn(startCall);
  const startRingOutFn = useServerFn(startRingOutCall);
  const endCallFn = useServerFn(endCall);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [localScripts, setLocalScripts] = useState<Record<string, CallScript>>({});
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [notes, setNotes] = useState("");

  // ---- Phone accounts (filtered to fully-configured / ready) ----
  type ReadyAccount = {
    id: string;
    label: string;
    provider: string;
    from_number: string | null;
    credentials: Record<string, string>;
    twilio_twiml_app_sid: string | null;
    is_default: boolean;
  };
  const [readyAccounts, setReadyAccounts] = useState<ReadyAccount[]>([]);
  const [phoneAccountId, setPhoneAccountId] = useState<string | null>(null);
  const phoneAccount = readyAccounts.find((a) => a.id === phoneAccountId) ?? null;

  // ---- In-call state ----
  const [device, setDevice] = useState<any>(null);
  const [connection, setConnection] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "ringing" | "in_progress" | "ending">("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [callStart, setCallStart] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);

  // Load all phone accounts, keep only the "ready" ones (same rule as Sending Accounts)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("user_phone_accounts")
        .select("id,label,provider,from_number,credentials,twilio_twiml_app_sid,is_default,created_at")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      const ready = (data ?? []).filter((a: any) => {
        const prov = a.provider ?? "twilio";
        if (prov === "twilio") {
          return !!a.from_number && a.from_number !== "+10000000000" && !!a.twilio_twiml_app_sid;
        }
        const spec = PROVIDER_SPECS[prov];
        if (!spec) return false;
        const creds = (a.credentials ?? {}) as Record<string, string>;
        return spec.fields.every((f) => !f.required || !!creds[f.key]?.trim());
      }) as ReadyAccount[];
      setReadyAccounts(ready);
      if (ready.length > 0) setPhoneAccountId(ready[0].id);
    })();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { connection?.disconnect?.(); } catch {}
      try { device?.destroy?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureTwilioDevice = async () => {
    if (!phoneAccount) throw new Error("No phone account selected");
    if (device) return device;
    const { token } = await getTokenFn({ data: { phoneAccountId: phoneAccount.id } });
    const { Device } = await import("@twilio/voice-sdk");
    const d = new Device(token, { codecPreferences: ["opus" as any, "pcmu" as any], logLevel: 1 } as any);
    await d.register();
    setDevice(d);
    return d;
  };

  const ensureRcWebPhone = async () => {
    if (!phoneAccount) throw new Error("No phone account selected");
    if (rcWebPhone) return rcWebPhone;
    const prov = await getRcSipFn({ data: { phoneAccountId: phoneAccount.id } });
    const mod: any = await import("ringcentral-web-phone");
    const WebPhone = mod.default ?? mod;
    const wp = new WebPhone(
      { sipInfo: prov.sipInfo, sipFlags: prov.sipFlags, sipErrorCodes: prov.sipErrorCodes },
      {
        appKey: prov.appKey,
        appName: "Lovable SDR",
        appVersion: "1.0.0",
        logLevel: 1,
        audioHelper: { enabled: true },
      } as any,
    );
    setRcWebPhone(wp);
    return wp;
  };

  const startInAppCall = async () => {
    if (!active?.lead?.phone) return toast.error("No phone number on this lead");
    if (!phoneAccount) return toast.error("No ready phone account — finish setup in Sending Accounts");
    try {
      setCallStatus("connecting");

      if (phoneAccount.provider === "ringcentral") {
        // RingCentral WebRTC — audio runs through the browser's mic/speakers.
        const wp = await ensureRcWebPhone();
        const { callId: newCallId } = await startRcWebCallFn({
          data: {
            listId,
            leadId: active.lead_id,
            phoneAccountId: phoneAccount.id,
            toNumber: active.lead.phone,
          },
        });
        setCallId(newCallId);
        const session = wp.userAgent.invite(active.lead.phone, {
          fromNumber: phoneAccount.from_number ?? undefined,
        });
        setRcSession(session);
        setCallStatus("ringing");
        session.on?.("progress", () => setCallStatus("ringing"));
        session.on?.("accepted", () => { setCallStatus("in_progress"); setCallStart(Date.now()); });
        session.on?.("terminated", () => finishCall(newCallId));
        session.on?.("failed", (e: any) => { toast.error(e?.message ?? "Call failed"); finishCall(newCallId); });
        session.on?.("rejected", () => finishCall(newCallId));
        session.on?.("bye", () => finishCall(newCallId));
        return;
      }

      // Twilio (browser WebRTC)
      const d = await ensureTwilioDevice();
      const { callId: newCallId } = await startCallFn({
        data: {
          listId,
          leadId: active.lead_id,
          phoneAccountId: phoneAccount.id,
          toNumber: active.lead.phone,
        },
      });
      setCallId(newCallId);
      const conn = await d.connect({ params: { To: active.lead.phone, callId: newCallId } });
      setConnection(conn);
      setCallStatus("ringing");
      conn.on("accept", () => { setCallStatus("in_progress"); setCallStart(Date.now()); });
      conn.on("disconnect", () => finishCall(newCallId));
      conn.on("cancel", () => finishCall(newCallId));
      conn.on("error", (e: any) => { toast.error(e?.message ?? "Call error"); finishCall(newCallId); });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to start call");
      setCallStatus("idle");
    }
  };

  const finishCall = async (idOverride?: string) => {
    const cid = idOverride ?? callId;
    setCallStatus("ending");
    const duration = callStart ? Math.round((Date.now() - callStart) / 1000) : undefined;
    try { connection?.disconnect?.(); } catch {}
    try { rcSession?.terminate?.(); } catch {}
    setConnection(null);
    setRcSession(null);
    setMuted(false);
    if (cid) {
      try { await endCallFn({ data: { callId: cid, durationSec: duration, notes: notes || undefined } }); } catch {}
    }
    setCallId(null);
    setCallStart(null);
    setCallStatus("idle");
  };

  const toggleMute = () => {
    const next = !muted;
    if (rcSession) {
      try { next ? rcSession.mute?.() : rcSession.unmute?.(); } catch {}
      setMuted(next);
      return;
    }
    if (!connection) return;
    connection.mute(next);
    setMuted(next);
  };

  useEffect(() => {
    if (initialActiveLeadId && rows.some((r) => r.lead_id === initialActiveLeadId)) {
      setActiveId(initialActiveLeadId);
      onConsumedInitial?.();
      return;
    }
    if (activeId || rows.length === 0) return;
    const firstWithPhone = rows.find((r) => r.lead?.phone);
    setActiveId((firstWithPhone ?? rows[0]).lead_id);
  }, [rows, activeId, initialActiveLeadId, onConsumedInitial]);

  useEffect(() => {
    setNotes("");
  }, [activeId]);

  const active = rows.find((r) => r.lead_id === activeId) ?? null;
  const activeScript = active ? (localScripts[active.lead_id] ?? active.call_script) : null;
  const activeIndex = active ? rows.findIndex((r) => r.lead_id === active.lead_id) : -1;

  const goTo = (delta: number) => {
    if (activeIndex < 0) return;
    const next = rows[activeIndex + delta];
    if (next) setActiveId(next.lead_id);
  };

  const generate = async (force = false) => {
    if (!active) return;
    setScriptBusy(true);
    try {
      const res = await genScriptFn({ data: { listId, leadId: active.lead_id, force } });
      setLocalScripts((p) => ({ ...p, [active.lead_id]: res.script }));
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate script");
    } finally {
      setScriptBusy(false);
    }
  };

  const logOutcome = async (outcome: string) => {
    if (!active) return;
    setOutcomeBusy(true);
    try {
      const { error } = await supabase.from("calls").insert({
        list_id: listId,
        lead_id: active.lead_id,
        to_number: active.lead?.phone ?? "",
        status: "completed",
        outcome,
        notes: notes || null,
        ended_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
      toast.success(`Logged: ${outcome}`);
      setNotes("");
      goTo(1);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to log call");
    } finally {
      setOutcomeBusy(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="p-8">
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No prospects yet. Add some from{" "}
          <Link to="/app/people" className="underline">People Search</Link>.
        </Card>
      </div>
    );
  }

  const withPhone = rows.filter((r) => r.lead?.phone);
  const scriptedCount = rows.filter((r) => r.call_script || localScripts[r.lead_id]).length;

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-80 shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Call queue</div>
              <div className="text-[11px] text-muted-foreground">
                {withPhone.length}/{rows.length} have phone · {scriptedCount} scripted
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={onOpenConfig}>
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {rows.map((r) => {
            const name = [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ") || "—";
            const isActive = r.lead_id === activeId;
            const hasScript = !!(r.call_script || localScripts[r.lead_id]);
            const hasPhone = !!r.lead?.phone;
            return (
              <button
                key={r.lead_id}
                onClick={() => setActiveId(r.lead_id)}
                className={`mb-1 w-full rounded-md border px-3 py-2 text-left transition ${
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-background"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                      r.score == null
                        ? "bg-muted text-muted-foreground"
                        : r.score >= 75
                          ? "bg-emerald-100 text-emerald-700"
                          : r.score >= 50
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {r.score ?? "—"}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{name}</span>
                  {hasScript && <Sparkles className="h-3 w-3 text-primary" />}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {r.lead?.title || "—"}{r.lead?.org_name ? ` · ${r.lead.org_name}` : ""}
                </div>
                <div className={`mt-0.5 truncate text-[11px] ${hasPhone ? "text-foreground" : "text-muted-foreground/60"}`}>
                  {hasPhone ? `☎ ${r.lead?.phone}` : "no phone"}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {active ? (
          <>
            <div className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <h2 className="truncate text-xl font-semibold tracking-tight">
                    {[active.lead?.first_name, active.lead?.last_name].filter(Boolean).join(" ") || "Lead"}
                  </h2>
                  <span className="truncate text-sm text-muted-foreground">
                    {active.lead?.title}{active.lead?.org_name ? ` · ${active.lead.org_name}` : ""}
                  </span>
                </div>
                {active.research?.reasoning && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{active.research.reasoning}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => goTo(-1)} disabled={activeIndex <= 0}>
                  ← Prev
                </Button>
                <Button size="sm" variant="ghost" onClick={() => goTo(1)} disabled={activeIndex >= rows.length - 1}>
                  Next →
                </Button>

                {readyAccounts.length > 1 && callStatus === "idle" && (
                  <Select value={phoneAccountId ?? undefined} onValueChange={setPhoneAccountId}>
                    <SelectTrigger className="h-9 w-[180px] text-xs">
                      <SelectValue placeholder="Choose phone" />
                    </SelectTrigger>
                    <SelectContent>
                      {readyAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-xs">
                          {a.label} · {a.provider}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {active.lead?.phone ? (
                  callStatus === "idle" ? (
                    readyAccounts.length === 0 ? (
                      <Link
                        to="/app/accounts"
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                      >
                        <AlertCircle className="h-3.5 w-3.5" /> Finish phone setup to call
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        onClick={startInAppCall}
                        title={`Call using ${phoneAccount?.label ?? "phone"}`}
                      >
                        <PhoneIcon className="mr-1.5 h-4 w-4" /> Call {active.lead.phone}
                      </Button>
                    )
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2 py-1">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      <span className="text-xs font-medium text-emerald-900">
                        {callStatus === "connecting" && "Connecting…"}
                        {callStatus === "ringing" && "Ringing…"}
                        {callStatus === "in_progress" && <CallTimer startedAt={callStart} />}
                        {callStatus === "ending" && "Ending…"}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={toggleMute} disabled={!connection && !rcSession}>
                        {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => finishCall()}>
                        <PhoneOff className="mr-1 h-3.5 w-3.5" /> Hang up
                      </Button>
                    </div>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">No phone on file</span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!activeScript ? (
                <div className="flex h-full items-center justify-center p-12">
                  <Card className="max-w-md p-8 text-center">
                    <PhoneCall className="mx-auto mb-3 h-8 w-8 text-primary" />
                    <div className="mb-1 text-base font-semibold">No script yet</div>
                    <p className="mb-4 text-sm text-muted-foreground">
                      Generate a NEPQ-style script personalized to this prospect using your Calling config.
                    </p>
                    <Button onClick={() => generate(false)} disabled={scriptBusy}>
                      {scriptBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Generate script
                    </Button>
                  </Card>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
                  <div className="space-y-5 lg:col-span-2">
                    <CallSection title="Opener" tone="primary">
                      <p className="whitespace-pre-wrap text-lg leading-relaxed">{activeScript.opener}</p>
                    </CallSection>
                    {activeScript.talk_track?.map((s, i) => (
                      <CallSection key={i} title={s.heading}>
                        <p className="whitespace-pre-wrap text-lg leading-relaxed">{s.body}</p>
                      </CallSection>
                    ))}
                    <CallSection title="Problem questions">
                      <BigList items={activeScript.problem_questions} />
                    </CallSection>
                    <CallSection title="Solution questions">
                      <BigList items={activeScript.solution_questions} />
                    </CallSection>
                    <CallSection title="Consequence questions">
                      <BigList items={activeScript.consequence_questions} />
                    </CallSection>
                    <CallSection title="Qualifying questions">
                      <BigList items={activeScript.qualifying_questions} />
                    </CallSection>
                    <CallSection title="Close" tone="primary">
                      <p className="text-lg leading-relaxed">{activeScript.close}</p>
                    </CallSection>
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => generate(true)} disabled={scriptBusy}>
                        {scriptBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        Regenerate
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Objection cheat-sheet
                      </div>
                      <div className="space-y-2">
                        {activeScript.objection_map.map((o, i) => (
                          <Card key={i} className="p-3">
                            <div className="text-sm font-semibold">{o.objection}</div>
                            <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{o.response}</div>
                          </Card>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Call notes
                      </div>
                      <Textarea
                        rows={5}
                        placeholder="Quick notes — saved with the outcome"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Log outcome
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { v: "booked", label: "✓ Booked", c: "bg-emerald-600 hover:bg-emerald-700 text-white" },
                          { v: "interested", label: "Interested", c: "" },
                          { v: "callback", label: "Callback", c: "" },
                          { v: "voicemail", label: "Voicemail", c: "" },
                          { v: "no_answer", label: "No answer", c: "" },
                          { v: "not_interested", label: "Not interested", c: "" },
                          { v: "wrong_number", label: "Wrong #", c: "" },
                          { v: "dnc", label: "Do not call", c: "" },
                        ].map((o) => (
                          <Button
                            key={o.v}
                            size="sm"
                            variant={o.c ? undefined : "outline"}
                            className={o.c}
                            disabled={outcomeBusy}
                            onClick={() => logOutcome(o.v)}
                          >
                            {o.label}
                          </Button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Logging auto-advances to the next prospect.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a prospect from the queue
          </div>
        )}
      </div>
    </div>
  );
}

function CallTimer({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt) return <>00:00</>;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <>{mm}:{ss}</>;
}

function SdrAssignBar({
  listId,
  currentAgentId,
  onChanged,
}: {
  listId: string;
  currentAgentId: string | null;
  onChanged: () => void;
}) {
  const listFn = useServerFn(listSdrAgents);
  const assignFn = useServerFn(assignAgentToList);
  const [agents, setAgents] = useState<Array<{ id: string; name: string; inbox_email: string | null }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listFn({}).then((r) => setAgents(r.agents as typeof agents)).catch(() => {});
  }, []);

  const handleChange = async (v: string) => {
    setSaving(true);
    try {
      await assignFn({ data: { list_id: listId, agent_id: v === "none" ? null : v } });
      toast.success(v === "none" ? "SDR paused for this campaign" : "SDR agent assigned");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const value = currentAgentId ?? "none";
  const active = agents.find((a) => a.id === currentAgentId);

  return (
    <div className="flex items-center gap-3 border-b bg-background px-8 py-2.5 text-sm">
      <Bot className="h-4 w-4 text-primary" />
      <span className="font-medium">AI SDR</span>
      <Select value={value} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="h-8 w-[260px]">
          <SelectValue placeholder="Select an agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— None (replies disabled) —</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}{a.inbox_email ? ` · ${a.inbox_email}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active ? (
        <span className="text-xs text-muted-foreground">
          Active — this agent will reply to inbound emails on this campaign.
        </span>
      ) : agents.length === 0 ? (
        <Link to="/app/sdr-agents" className="text-xs text-primary hover:underline">
          Create an agent →
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">No agent assigned. Pick one to enable auto-reply.</span>
      )}
    </div>
  );
}
