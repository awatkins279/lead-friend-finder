import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
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
import { VoicemailRecorder } from "@/components/VoicemailRecorder";
import { getVoicemailProfile } from "@/lib/voicemail.functions";
import { generateVoicemailScript, synthesizeVoicemail, logVoicemailDrop } from "@/lib/voicemail.functions";

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
import { generateCallScript, getTwilioToken, startCall, endCall, type CallScript } from "@/lib/calls.functions";
import { getRingCentralWebPhoneCreds, startRingCentralBrowserCall } from "@/lib/ringcentral.functions";
import { Phone as PhoneIcon, PhoneOff, MicOff, Mic, Bot, Play, Pause, Minus, Plus, RotateCcw, Voicemail, MessageSquare } from "lucide-react";
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

type ListRow = CampaignConfig & { id: string; sdr_agent_id: string | null; voicemail_audio_url: string | null; ai_copilot_enabled: boolean | null };

function ListDetailPage() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichLead);
  const genScriptBulkFn = useServerFn(generateCallScript);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [callConfigOpen, setCallConfigOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "email" | "calling">("email");
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
          "id, name, description, sender_name, sender_title, sender_company, what_selling, key_selling_points, num_emails, word_count, personalization_level, cta_type, extra_instructions, sdr_agent_id, voicemail_audio_url, ai_copilot_enabled",
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
    <div className="flex h-screen flex-col bg-[oklch(0.13_0.02_265)]">
      <header className="border-b border-white/5 bg-[oklch(0.13_0.02_265)] px-8 py-6">
        <Link to="/app/lists" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Campaigns / <span className="truncate">{list?.name ?? "…"}</span>
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground">
                {list?.name ?? "Loading…"}
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Last activity: <LastActivityLabel listId={listId} />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
              <Settings2 className="mr-2 h-3.5 w-3.5" /> Campaign config
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCallConfigOpen(true)}>
              <Headphones className="mr-2 h-3.5 w-3.5" /> Calling config
            </Button>
            <Button
              size="sm"
              onClick={activeTab === "calling" ? requestRunAllScripts : runAll}
              disabled={!rows || rows.length === 0 || (activeTab === "email" && !isConfigured) || isRunning}
            >
              {isRunning ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
              {isRunning
                ? "Generating…"
                : activeTab === "calling"
                  ? "Generate all scripts"
                  : "Generate all sequences"}
            </Button>
          </div>
        </div>
      </header>

      <SdrAssignBar listId={listId} currentAgentId={list?.sdr_agent_id ?? null} onChanged={() => refetchList()} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "email" | "calling")} className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b bg-background px-8">
          <TabsList className="h-11 bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent px-4 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Sparkles className="mr-2 h-4 w-4" /> Overview
            </TabsTrigger>
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

        <TabsContent value="overview" className="m-0 flex-1 overflow-y-auto p-8">
          <CampaignStatStrip listId={listId} totalProspects={(rows ?? []).length} enrichedCount={enrichedCount} />
        </TabsContent>


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
            <ProspectTable
              listId={listId}
              rows={rows}
              busy={busy}
              onOpenRow={(r) => setOpen(r)}
              onGenerate={(leadId) => runOne(leadId)}
              onRemove={(leadId) => remove(leadId)}
            />
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
            voicemailAudioPath={list?.voicemail_audio_url ?? null}
            onVoicemailChanged={() => refetchList()}
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
  voicemailAudioPath,
  onVoicemailChanged,
}: {
  listId: string;
  rows: Row[];
  initialActiveLeadId?: string | null;
  onConsumedInitial?: () => void;
  onOpenConfig: () => void;
  onChanged: () => void;
  voicemailAudioPath: string | null;
  onVoicemailChanged: () => void;
}) {

  const genScriptFn = useServerFn(generateCallScript);
  const getTokenFn = useServerFn(getTwilioToken);
  const startCallFn = useServerFn(startCall);
  const startRcCallFn = useServerFn(startRingCentralBrowserCall);
  const getRcCredsFn = useServerFn(getRingCentralWebPhoneCreds);
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
  const [rcWebPhone, setRcWebPhone] = useState<any>(null);
  const [rcSession, setRcSession] = useState<any>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Refs used by the voicemail-drop feature so we can restore the mic track
  // after the prerecorded clip finishes playing.
  const vmAudioRef = useRef<HTMLAudioElement | null>(null);
  const vmCtxRef = useRef<AudioContext | null>(null);
  const vmOriginalTrackRef = useRef<MediaStreamTrack | null>(null);
  const vmSenderRef = useRef<RTCRtpSender | null>(null);
  const [voicemailDropping, setVoicemailDropping] = useState(false);

  // ---- AI Voicemail Agent ----
  const genVmScriptFn = useServerFn(generateVoicemailScript);
  const synthVmFn = useServerFn(synthesizeVoicemail);
  const logVmFn = useServerFn(logVoicemailDrop);
  const vmScriptsRef = useRef<Map<string, Promise<string>>>(new Map());
  const [aiVmDropping, setAiVmDropping] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);




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
        if (prov === "ringcentral") {
          const creds = (a.credentials ?? {}) as Record<string, string>;
          return !!creds.client_id && !!creds.client_secret && !!creds.refresh_token;
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

  const startInAppCall = async () => {
    if (!active?.lead?.phone) return toast.error("No phone number on this lead");
    if (!phoneAccount) return toast.error("No ready phone account — finish setup in Sending Accounts");
    try {
      setCallStatus("connecting");
      setFocusMode(true);


      if (phoneAccount.provider === "ringcentral") {
        // RingCentral browser WebRTC via ringcentral-web-phone
        const { sipInfo, accessToken: _at } = await getRcCredsFn({
          data: { phoneAccountId: phoneAccount.id },
        });
        const { default: WebPhone } = await import("ringcentral-web-phone");
        const sip = Array.isArray((sipInfo as any).sipInfo) ? (sipInfo as any).sipInfo[0] : sipInfo;
        const wp = new (WebPhone as any)({ sipInfo: sip });
        await wp.start();
        setRcWebPhone(wp);

        const { callId: newCallId } = await startRcCallFn({
          data: {
            listId,
            leadId: active.lead_id,
            phoneAccountId: phoneAccount.id,
            toNumber: active.lead.phone,
          },
        });
        setCallId(newCallId);
        setCallStatus("ringing");

        const callee = active.lead.phone.replace(/[^\d+]/g, "");
        const callerId = (phoneAccount.from_number || "").replace(/[^\d+]/g, "");
        const session = await wp.call(callee, callerId || undefined);
        setRcSession(session);
        session.once("answered", () => { setCallStatus("in_progress"); setCallStart(Date.now()); });
        session.once("disposed", () => finishCall(newCallId));
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
    // Twilio
    try { connection?.disconnect?.(); } catch {}
    // RingCentral — hang up the SIP session and tear down the web phone
    try { await rcSession?.hangup?.(); } catch {}
    try { await rcSession?.dispose?.(); } catch {}
    try { await rcWebPhone?.dispose?.(); } catch {}
    setConnection(null);
    setRcSession(null);
    setRcWebPhone(null);
    setMuted(false);
    if (cid) {
      try { await endCallFn({ data: { callId: cid, durationSec: duration, notes: notes || undefined } }); } catch {}
    }
    setCallId(null);
    setCallStart(null);
    setCallStatus("idle");
    setFocusMode(false);
  };



  const toggleMute = () => {
    const next = !muted;
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

  // Hang up the current call (if any) and jump to the next prospect in the
  // queue that has a phone number. Used by the "Next call" button in focus mode.
  const hangupAndNext = async () => {
    if (callStatus !== "idle") {
      await finishCall();
    }
    if (activeIndex < 0) return;
    const nextWithPhone = rows.slice(activeIndex + 1).find((r) => r.lead?.phone);
    const next = nextWithPhone ?? rows[activeIndex + 1];
    if (next) {
      setActiveId(next.lead_id);
      setFocusMode(true);
    } else {
      toast.info("No more prospects in the queue");
      setFocusMode(false);
    }
  };

  // Find the outbound audio RTP sender for whichever provider is active so we
  // can swap the live mic feed for our prerecorded voicemail audio.
  const getOutboundAudioSender = (): RTCRtpSender | null => {
    try {
      const rcPc: RTCPeerConnection | undefined =
        rcSession?.sessionDescriptionHandler?.peerConnection;
      if (rcPc) return rcPc.getSenders().find((s) => s.track?.kind === "audio") ?? null;
    } catch {}
    try {
      const twPc: RTCPeerConnection | undefined =
        connection?._mediaHandler?.version?.pc ??
        connection?.mediaStream?.version?.pc ??
        connection?._mediaHandler?.pc;
      if (twPc) return twPc.getSenders().find((s) => s.track?.kind === "audio") ?? null;
    } catch {}
    return null;
  };

  /**
   * Drop the prerecorded voicemail into the active call:
   *  1. Fetch a signed URL for the audio file
   *  2. Replace the outbound mic track with audio piped from an <audio> element
   *  3. When playback ends, restore the mic, hang up, and advance to the next lead
   */
  const dropVoicemailAndNext = async () => {
    if (!voicemailAudioPath) {
      toast.error("No voicemail recorded for this campaign yet");
      return;
    }
    const sender = getOutboundAudioSender();
    if (!sender) {
      toast.error("Voicemail drop isn't available on this call");
      return;
    }
    setVoicemailDropping(true);
    try {
      const { data: signed, error } = await supabase.storage
        .from("voicemail-drops")
        .createSignedUrl(voicemailAudioPath, 60);
      if (error || !signed?.signedUrl) throw error ?? new Error("No signed URL");

      const audio = new Audio(signed.signedUrl);
      audio.crossOrigin = "anonymous";
      vmAudioRef.current = audio;

      const ctx = new AudioContext();
      vmCtxRef.current = ctx;
      const source = ctx.createMediaElementSource(audio);
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      // Don't connect to ctx.destination — we don't want to hear it locally.

      vmOriginalTrackRef.current = sender.track ?? null;
      vmSenderRef.current = sender;
      const vmTrack = dest.stream.getAudioTracks()[0];
      await sender.replaceTrack(vmTrack);

      audio.onended = async () => {
        try { await sender.replaceTrack(vmOriginalTrackRef.current); } catch {}
        try { await ctx.close(); } catch {}
        vmAudioRef.current = null;
        vmCtxRef.current = null;
        vmOriginalTrackRef.current = null;
        vmSenderRef.current = null;
        // Hang up the live call and roll to the next prospect
        await hangupAndNext();

        setVoicemailDropping(false);
      };

      audio.onerror = () => {
        toast.error("Couldn't play the voicemail audio");
        setVoicemailDropping(false);
      };
      await audio.play();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to drop voicemail");
      setVoicemailDropping(false);
    }
  };

  /**
   * AI Voicemail Drop:
   *  - Uses the pre-generated personalized script (or generates on demand)
   *  - Synthesizes via ElevenLabs in the user's cloned voice
   *  - Pipes the MP3 through the active call's outbound RTP sender
   *  - Logs the drop, hangs up, and advances to the next prospect
   */
  const dropAiVoicemailAndNext = async () => {
    if (!active) return;
    const sender = getOutboundAudioSender();
    if (!sender) { toast.error("AI voicemail isn't available on this call"); return; }
    setAiVmDropping(true);
    let script = "";
    let voiceId: string | null = null;
    try {
      const pending = vmScriptsRef.current.get(active.lead_id);
      script = pending
        ? await pending
        : (await genVmScriptFn({ data: { listId, leadId: active.lead_id } })).script;
      if (!script) throw new Error("Empty script");

      const synth = await synthVmFn({ data: { script } });
      voiceId = synth.voiceId;

      const audio = new Audio(`data:audio/mpeg;base64,${synth.audioBase64}`);
      audio.crossOrigin = "anonymous";
      vmAudioRef.current = audio;

      const ctx = new AudioContext();
      vmCtxRef.current = ctx;
      const source = ctx.createMediaElementSource(audio);
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);

      vmOriginalTrackRef.current = sender.track ?? null;
      vmSenderRef.current = sender;
      const vmTrack = dest.stream.getAudioTracks()[0];
      await sender.replaceTrack(vmTrack);

      const leadIdSnap = active.lead_id;
      const callIdSnap = callId;

      audio.onended = async () => {
        try { await sender.replaceTrack(vmOriginalTrackRef.current); } catch {}
        try { await ctx.close(); } catch {}
        vmAudioRef.current = null;
        vmCtxRef.current = null;
        vmOriginalTrackRef.current = null;
        vmSenderRef.current = null;
        logVmFn({ data: {
          listId, leadId: leadIdSnap, callId: callIdSnap,
          script, voiceId, audioSeconds: audio.duration || undefined, status: "sent",
        }}).catch(() => {});
        vmScriptsRef.current.delete(leadIdSnap);
        toast.success("AI voicemail sent");
        await hangupAndNext();
        setAiVmDropping(false);
      };
      audio.onerror = () => {
        logVmFn({ data: {
          listId, leadId: leadIdSnap, callId: callIdSnap,
          script, voiceId, status: "failed", error: "playback error",
        }}).catch(() => {});
        toast.error("Couldn't play AI voicemail");
        setAiVmDropping(false);
      };
      await audio.play();
    } catch (e: any) {
      logVmFn({ data: {
        listId, leadId: active.lead_id, callId,
        script: script || "(generation failed)",
        voiceId, status: "failed", error: (e?.message ?? "unknown").slice(0, 400),
      }}).catch(() => {});
      toast.error(e?.message ?? "AI voicemail failed");
      setAiVmDropping(false);
    }
  };

  // Pre-generate the AI voicemail script the moment a call begins, so the drop
  // is instant if it goes to voicemail. If the prospect answers we silently
  // discard it (no ElevenLabs credit used since audio is never synthesized).
  useEffect(() => {
    if (!active) return;
    if (callStatus !== "connecting" && callStatus !== "ringing") return;
    if (vmScriptsRef.current.has(active.lead_id)) return;
    const leadId = active.lead_id;
    const p = genVmScriptFn({ data: { listId, leadId } })
      .then((r) => r.script)
      .catch(() => "");
    vmScriptsRef.current.set(leadId, p);
  }, [callStatus, active, listId, genVmScriptFn]);






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
      setFocusMode(false);
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
    <>
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
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={toggleMute} disabled={!connection}>
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

            {userId && (
              <details className="group border-b bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-2.5 text-xs hover:bg-muted/30">
                  <span className="flex items-center gap-2 font-medium text-muted-foreground">
                    <Voicemail className="h-3.5 w-3.5" />
                    Voicemail drop
                    <span className="text-[10px] text-muted-foreground/70">
                      {voicemailAudioPath ? "· prerecorded ready" : "· not configured"}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground transition group-open:rotate-180">▾</span>
                </summary>
                <div className="space-y-3 px-6 pb-4 pt-1">
                  <AiVoicemailStatusBadge userId={userId} />
                  <VoicemailRecorder
                    listId={listId}
                    userId={userId}
                    currentPath={voicemailAudioPath}
                    onChange={() => onVoicemailChanged()}
                  />
                </div>
              </details>
            )}



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
    {focusMode && active && activeScript ? (
      <FocusCallView
        leadName={`${active.lead?.first_name ?? ""} ${active.lead?.last_name ?? ""}`.trim() || "Lead"}
        leadSub={`${active.lead?.title ?? ""}${active.lead?.title && active.lead?.org_name ? " · " : ""}${active.lead?.org_name ?? ""}`}
        phone={active.lead?.phone ?? null}
        script={activeScript}
        notes={notes}
        onNotesChange={setNotes}
        callStatus={callStatus}
        callStart={callStart}
        muted={muted}
        canMute={!!connection}
        onToggleMute={toggleMute}
        onHangUp={() => finishCall()}
        onExit={async () => { await finishCall(); }}
        onNext={hangupAndNext}
        hasNext={activeIndex >= 0 && activeIndex < rows.length - 1}
        canDropVoicemail={!!voicemailAudioPath && callStatus === "in_progress" && !voicemailDropping}
        onDropVoicemail={dropVoicemailAndNext}
        voicemailDropping={voicemailDropping}
        canDropAiVoicemail={callStatus === "in_progress" && !aiVmDropping}
        onDropAiVoicemail={dropAiVoicemailAndNext}
        aiVmDropping={aiVmDropping}
        outcomeBusy={outcomeBusy}
        onLogOutcome={logOutcome}
      />


    ) : null}

    </>
  );
}

function FocusCallView({
  leadName,
  leadSub,
  phone,
  script,
  notes,
  onNotesChange,
  callStatus,
  callStart,
  muted,
  canMute,
  onToggleMute,
  onHangUp,
  onExit,
  onNext,
  hasNext,
  canDropVoicemail,
  onDropVoicemail,
  voicemailDropping,
  canDropAiVoicemail,
  onDropAiVoicemail,
  aiVmDropping,
  outcomeBusy,
  onLogOutcome,
}: {
  leadName: string;
  leadSub: string;
  phone: string | null;
  script: CallScript;
  notes: string;
  onNotesChange: (v: string) => void;
  callStatus: "idle" | "connecting" | "ringing" | "in_progress" | "ending";
  callStart: number | null;
  muted: boolean;
  canMute: boolean;
  onToggleMute: () => void;
  onHangUp: () => void;
  onExit: () => void;
  onNext: () => void;
  hasNext: boolean;
  canDropVoicemail: boolean;
  onDropVoicemail: () => void;
  voicemailDropping: boolean;
  canDropAiVoicemail: boolean;
  onDropAiVoicemail: () => void;
  aiVmDropping: boolean;
  outcomeBusy: boolean;
  onLogOutcome: (outcome: string) => void;
}) {


  const outcomes = [
    { v: "booked", label: "✓ Booked", c: "bg-emerald-600 hover:bg-emerald-700 text-white" },
    { v: "interested", label: "Interested", c: "" },
    { v: "callback", label: "Callback", c: "" },
    { v: "voicemail", label: "Voicemail", c: "" },
    { v: "no_answer", label: "No answer", c: "" },
    { v: "not_interested", label: "Not interested", c: "" },
    { v: "wrong_number", label: "Wrong #", c: "" },
    { v: "dnc", label: "Do not call", c: "" },
  ];

  const statusLabel =
    callStatus === "connecting" ? "CONNECTING" :
    callStatus === "ringing" ? "RINGING" :
    callStatus === "in_progress" ? "IN CALL" :
    callStatus === "ending" ? "ENDING" : "IDLE";

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-[oklch(0.12_0.04_270)] text-foreground">
      {/* Ambient aurora background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.70_0.18_290/0.35),transparent_70%)] blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,oklch(0.78_0.16_210/0.30),transparent_70%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1_0_0/0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(1_0_0/0.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, black 40%, transparent 85%)",
          }}
        />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex shrink-0 items-start justify-between gap-4 px-7 pt-6 pb-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-[2.75rem] font-extrabold leading-none tracking-tight text-white">
            {leadName}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {leadSub && <span className="truncate">{leadSub}</span>}
            {phone && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 font-mono text-xs tracking-wider text-[oklch(0.88_0.10_210)]">
                <Phone className="h-3 w-3" /> {phone}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {/* Top row: status + quick actions + AI Voicemail */}
          <div className="flex items-center gap-2">
            {callStatus !== "idle" ? (
              <div className="flex items-center gap-3 pr-1">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_12px_oklch(0.78_0.18_150)]" />
                </span>
                <span className="font-mono text-2xl font-semibold tabular-nums text-white">
                  {callStatus === "in_progress" ? <CallTimer startedAt={callStart} /> : statusLabel}
                </span>
              </div>
            ) : (
              <span className="pr-1 font-mono text-2xl font-semibold tabular-nums text-muted-foreground/60">00:00</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onDropVoicemail}
              disabled={!canDropVoicemail}
              className="h-10 w-10 rounded-xl border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
              title={canDropVoicemail ? "Drop prerecorded voicemail" : "Record a voicemail first"}
            >
              {voicemailDropping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Voicemail className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleMute}
              disabled={!canMute}
              className="h-10 w-10 rounded-xl border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              onClick={onDropAiVoicemail}
              disabled={!canDropAiVoicemail}
              className="h-10 rounded-xl border-0 bg-gradient-to-r from-[oklch(0.50_0.22_295)] to-[oklch(0.58_0.20_275)] px-4 text-white shadow-[0_0_22px_-6px_oklch(0.70_0.18_290/0.9)] hover:opacity-95"
            >
              {aiVmDropping ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Sending…</>
              ) : (
                <><Sparkles className="mr-1.5 h-4 w-4" /> AI Voicemail</>
              )}
            </Button>
          </div>

          {/* Bottom row: Hang up + Next call + Exit */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={onHangUp}
              disabled={callStatus === "idle"}
              className="h-10 rounded-xl border-0 bg-gradient-to-r from-[oklch(0.62_0.22_28)] to-[oklch(0.66_0.22_18)] px-5 text-white shadow-[0_0_22px_-6px_oklch(0.66_0.22_18/0.9)] hover:opacity-95 disabled:opacity-40"
            >
              <PhoneOff className="mr-1.5 h-4 w-4" /> Hang up
            </Button>
            <Button
              size="sm"
              onClick={onNext}
              disabled={!hasNext}
              className="h-10 rounded-xl border border-[oklch(0.55_0.22_290/0.6)] bg-[oklch(0.55_0.22_290/0.12)] px-5 text-[oklch(0.90_0.10_290)] hover:bg-[oklch(0.55_0.22_290/0.22)]"
            >
              <Sparkles className="mr-1.5 h-4 w-4" /> Next call
            </Button>
            <Button size="sm" variant="ghost" onClick={onExit} className="h-10 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground">
              <X className="mr-1 h-4 w-4" /> Exit
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-12 gap-4 px-6 pb-6">
        {/* Script panel — teleprompter */}
        <section className="col-span-7 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_8px_40px_-12px_oklch(0_0_0/0.6)] backdrop-blur-xl">
          <Teleprompter script={script} />
        </section>

        {/* Objections panel */}
        <section className="col-span-5 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[0_8px_40px_-12px_oklch(0_0_0/0.6)] backdrop-blur-xl">
          <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-3">
            <div className="rounded-xl bg-gradient-to-r from-[oklch(0.55_0.18_200)] to-[oklch(0.62_0.15_185)] px-4 py-2 shadow-[0_0_24px_-6px_oklch(0.78_0.16_210/0.8)]">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-white">Objection answers</span>
            </div>
          </div>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-4">
            {script.objection_map.length === 0 ? (
              <p className="px-2 text-sm text-muted-foreground">No objections configured.</p>
            ) : (
              script.objection_map.map((o, i) => {
                const palette = [
                  "from-[oklch(0.62_0.18_265)] to-[oklch(0.70_0.16_280)]",
                  "from-[oklch(0.65_0.18_300)] to-[oklch(0.72_0.16_320)]",
                  "from-[oklch(0.68_0.18_340)] to-[oklch(0.72_0.17_355)]",
                  "from-[oklch(0.72_0.16_60)] to-[oklch(0.75_0.16_85)]",
                  "from-[oklch(0.62_0.16_200)] to-[oklch(0.68_0.15_220)]",
                ];
                const grad = palette[i % palette.length];
                return (
                  <div
                    key={i}
                    className="group flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition hover:border-[oklch(0.78_0.16_210/0.5)] hover:bg-white/[0.06]"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${grad} shadow-[0_0_14px_-4px_oklch(0.70_0.18_290/0.7)]`}>
                      <MessageSquare className="h-4 w-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{o.objection}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{o.response}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function FuturisticBlock({
  label,
  highlight,
  children,
}: {
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        <span className="h-px w-4 bg-gradient-to-r from-[oklch(0.70_0.18_290)] to-transparent" />
        {label}
      </div>
      <div
        className={
          highlight
            ? "relative overflow-hidden rounded-xl border border-[oklch(0.70_0.18_290/0.45)] bg-[oklch(0.70_0.18_290/0.08)] p-4 shadow-[0_0_30px_-12px_oklch(0.70_0.18_290/0.8)]"
            : "rounded-xl border border-white/10 bg-white/[0.04] p-4"
        }
      >
        {highlight && (
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_210)] to-transparent" />
        )}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teleprompter — auto-scrolling script reader for live calls.
// Space = play/pause, ↑/↓ = speed, R = reset to top.
// ---------------------------------------------------------------------------
function Teleprompter({ script }: { script: CallScript }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(35); // pixels per second
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  // rAF auto-scroll loop
  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (t: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      if (lastTickRef.current != null) {
        const dt = (t - lastTickRef.current) / 1000;
        el.scrollTop += speed * dt;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
          setPlaying(false);
          return;
        }
      }
      lastTickRef.current = t;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setSpeed((s) => Math.min(120, s + 5));
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setSpeed((s) => Math.max(10, s - 5));
      } else if (e.key === "r" || e.key === "R") {
        scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wheel / touch = manual control, pause auto-scroll
  const onUserScroll = () => {
    if (playing) setPlaying(false);
  };

  const reset = () => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setPlaying(false);
  };

  return (
    <>
      {/* Control bar */}
      <div className="relative flex shrink-0 items-center justify-between gap-4 px-5 pt-5 pb-3">
        <div className="rounded-xl bg-gradient-to-r from-[oklch(0.50_0.22_295)] to-[oklch(0.58_0.20_310)] px-4 py-2 shadow-[0_0_24px_-6px_oklch(0.55_0.22_290/0.9)]">
          <span className="text-xs font-bold uppercase tracking-[0.25em] text-white">Script</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => setSpeed((s) => Math.max(10, s - 5))}
            className="h-8 w-8 border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
            title="Slower (↓)"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <div className="flex h-8 min-w-[78px] items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-2 font-mono text-xs tracking-wider text-[oklch(0.88_0.10_210)]">
            {speed} px/s
          </div>
          <Button
            size="sm"
            onClick={() => setSpeed((s) => Math.min(120, s + 5))}
            className="h-8 w-8 border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
            title="Faster (↑)"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => setPlaying((p) => !p)}
            className="ml-1 h-8 border-0 bg-gradient-to-r from-[oklch(0.70_0.18_290)] to-[oklch(0.78_0.16_210)] px-3 text-white shadow-[0_0_18px_-4px_oklch(0.70_0.18_290/0.9)] hover:opacity-95"
            title="Play/Pause (Space)"
          >
            {playing ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            size="sm"
            onClick={reset}
            className="h-8 w-8 border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
            title="Restart (R)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Teleprompter viewport */}
      <div className="relative min-h-0 flex-1">
        {/* Fade top */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[oklch(0.16_0.04_270)] via-[oklch(0.16_0.04_270/0.85)] to-transparent" />
        {/* Reading line at ~40% from top */}
        <div className="pointer-events-none absolute inset-x-0 top-[40%] z-10 flex h-0 items-center">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_210/0.7)] to-transparent shadow-[0_0_18px_oklch(0.78_0.16_210/0.7)]" />
          <span className="mx-2 font-mono text-[9px] uppercase tracking-[0.3em] text-[oklch(0.85_0.10_210)]">read here</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_210/0.7)] to-transparent shadow-[0_0_18px_oklch(0.78_0.16_210/0.7)]" />
        </div>
        {/* Fade bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-[oklch(0.16_0.04_270)] via-[oklch(0.16_0.04_270/0.85)] to-transparent" />

        <div
          ref={scrollerRef}
          onWheel={onUserScroll}
          onTouchMove={onUserScroll}
          className="h-full overflow-y-auto px-10 py-[40vh] [scrollbar-width:thin]"
        >
          <div className="mx-auto max-w-3xl space-y-8 text-balance text-[1.5rem] leading-[1.65] tracking-tight text-foreground">
            <TpSection label="Opener" highlight>{script.opener}</TpSection>
            {script.talk_track?.map((s, i) => (
              <TpSection key={i} label={s.heading}>{s.body}</TpSection>
            ))}
            {script.problem_questions?.length > 0 && (
              <TpQuestions label="Problem questions" items={script.problem_questions} />
            )}
            {script.consequence_questions?.length > 0 && (
              <TpQuestions label="Consequence questions" items={script.consequence_questions} />
            )}
            {script.solution_questions?.length > 0 && (
              <TpQuestions label="Solution questions" items={script.solution_questions} />
            )}
            {script.qualifying_questions?.length > 0 && (
              <TpQuestions label="Qualifying questions" items={script.qualifying_questions} />
            )}
            <TpSection label="Close" highlight>{script.close}</TpSection>
            <div className="pt-8 text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
              — end of script —
            </div>
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="shrink-0 border-t border-white/10 px-5 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        space play/pause · ↑ ↓ speed · r restart · scroll to take over
      </div>
    </>
  );
}

function TpSection({ label, highlight, children }: { label: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        <span className="h-px w-8 bg-gradient-to-r from-[oklch(0.70_0.18_290)] to-transparent" />
        {label}
      </div>
      <p
        className={
          highlight
            ? "whitespace-pre-wrap rounded-2xl border border-[oklch(0.70_0.18_290/0.45)] bg-[oklch(0.70_0.18_290/0.08)] p-6 shadow-[0_0_40px_-12px_oklch(0.70_0.18_290/0.8)]"
            : "whitespace-pre-wrap"
        }
      >
        {children}
      </p>
    </div>
  );
}

function TpQuestions({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        <span className="h-px w-8 bg-gradient-to-r from-[oklch(0.78_0.16_210)] to-transparent" />
        {label}
      </div>
      <ol className="space-y-3">
        {items.map((q, i) => (
          <li key={i} className="flex gap-4">
            <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[oklch(0.78_0.16_210/0.4)] bg-[oklch(0.78_0.16_210/0.12)] font-mono text-xs font-bold text-[oklch(0.88_0.10_210)]">
              {i + 1}
            </span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}



function FocusQList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        <span className="h-px w-4 bg-gradient-to-r from-[oklch(0.78_0.16_210)] to-transparent" />
        {title}
      </div>
      <ol className="space-y-1.5">
        {items.map((q, i) => (
          <li
            key={i}
            className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-base leading-relaxed transition hover:border-[oklch(0.78_0.16_210/0.4)] hover:bg-white/[0.06]"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[oklch(0.78_0.16_210/0.4)] bg-[oklch(0.78_0.16_210/0.12)] font-mono text-[11px] font-bold text-[oklch(0.88_0.10_210)]">
              {i + 1}
            </span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
  capitalize,
}: {
  label: string;
  value: string | number;
  accent?: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card px-3.5 py-2.5 shadow-sm transition-colors hover:bg-accent/30">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold leading-tight ${capitalize ? "capitalize" : ""} ${accent ?? "text-foreground"}`}>
        {value}
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

function AiVoicemailStatusBadge({ userId: _userId }: { userId: string }) {
  const getProfileFn = useServerFn(getVoicemailProfile);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    getProfileFn()
      .then((p: any) => { if (alive) setOn(Boolean(p?.voice_id)); })
      .catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, [getProfileFn]);
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium">AI Voicemail Agent</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
          on ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
          {on === null ? "…" : on ? "On" : "Off"}
        </span>
      </div>
      <Link to="/app/voicemail-agent" className="text-xs text-primary hover:underline">
        Configure →
      </Link>
    </div>
  );
}

// ============================================================
// Campaign detail — table-style redesign helpers
// ============================================================

type CallAgg = {
  attempts: number;
  connects: number;
  meetings: number;
  lastStartedAt: string | null;
  lastStatus: string | null;
  lastOutcome: string | null;
  lastDurationSec: number | null;
};

function useCampaignCalls(listId: string) {
  return useQuery({
    queryKey: ["campaign-calls", listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select("lead_id, status, outcome, duration_sec, started_at")
        .eq("list_id", listId)
        .order("started_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Array<{
        lead_id: string;
        status: string;
        outcome: string | null;
        duration_sec: number | null;
        started_at: string;
      }>;
    },
    refetchInterval: 30000,
  });
}

function aggregateByLead(
  calls:
    | Array<{
        lead_id: string;
        status: string;
        outcome: string | null;
        duration_sec: number | null;
        started_at: string;
      }>
    | undefined,
): Map<string, CallAgg> {
  const m = new Map<string, CallAgg>();
  if (!calls) return m;
  for (const c of calls) {
    const cur =
      m.get(c.lead_id) ?? {
        attempts: 0,
        connects: 0,
        meetings: 0,
        lastStartedAt: null as string | null,
        lastStatus: null as string | null,
        lastOutcome: null as string | null,
        lastDurationSec: null as number | null,
      };
    cur.attempts += 1;
    const connected = c.status === "completed" && (c.duration_sec ?? 0) >= 20;
    if (connected) cur.connects += 1;
    if (c.outcome === "meeting_booked" || c.outcome === "meeting") cur.meetings += 1;
    if (!cur.lastStartedAt) {
      cur.lastStartedAt = c.started_at;
      cur.lastStatus = c.status;
      cur.lastOutcome = c.outcome;
      cur.lastDurationSec = c.duration_sec;
    }
    m.set(c.lead_id, cur);
  }
  return m;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatActivityTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

function LastActivityLabel({ listId }: { listId: string }) {
  const { data: calls } = useCampaignCalls(listId);
  const latest = calls && calls.length > 0 ? calls[0].started_at : null;
  return <span>{latest ? formatActivityTimestamp(latest) : "no calls yet"}</span>;
}

function Sparkline({ points, stroke }: { points: number[]; stroke: string }) {
  if (points.length === 0) return <div className="h-10 w-full" />;
  const w = 160;
  const h = 36;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p / max) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const gradId = `spk-${stroke.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function bucketByDay(isoList: string[], days = 14): number[] {
  const buckets = new Array(days).fill(0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (const iso of isoList) {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff >= 0 && diff < days) buckets[days - 1 - diff] += 1;
  }
  return buckets;
}

function StatCardLg({
  label,
  value,
  sub,
  icon,
  spark,
  sparkColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  spark: number[];
  sparkColor: string;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-muted-foreground/60">{icon}</div>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        {sub ? <div className="text-sm text-muted-foreground">{sub}</div> : null}
      </div>
      <div className="mt-3">
        <Sparkline points={spark} stroke={sparkColor} />
      </div>
    </div>
  );
}

function CampaignStatStrip({
  listId,
  totalProspects,
  enrichedCount,
}: {
  listId: string;
  totalProspects: number;
  enrichedCount: number;
}) {
  const { data: calls } = useCampaignCalls(listId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const callsToday = (calls ?? []).filter((c) => new Date(c.started_at).getTime() >= todayMs);
  const calledTodayCount = callsToday.length;
  const connected = (calls ?? []).filter(
    (c) => c.status === "completed" && (c.duration_sec ?? 0) >= 20,
  );
  const connectedTodayCount = connected.filter(
    (c) => new Date(c.started_at).getTime() >= todayMs,
  ).length;
  const connectRate = calledTodayCount > 0 ? (connectedTodayCount / calledTodayCount) * 100 : 0;
  const meetings = (calls ?? []).filter(
    (c) => c.outcome === "meeting_booked" || c.outcome === "meeting",
  );

  const sparkProspects = new Array(14).fill(0).map((_, i) => Math.max(1, totalProspects - (13 - i)));
  const sparkCalls = bucketByDay((calls ?? []).map((c) => c.started_at), 14);
  const sparkConnected = bucketByDay(connected.map((c) => c.started_at), 14);
  const sparkMeetings = bucketByDay(meetings.map((c) => c.started_at), 14);

  return (
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCardLg
        label="Prospects"
        value={totalProspects.toLocaleString()}
        sub={enrichedCount > 0 ? `${enrichedCount} researched` : undefined}
        icon={
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="8" r="3.5" />
            <circle cx="17" cy="10" r="2.5" />
            <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
          </svg>
        }
        spark={sparkProspects}
        sparkColor="oklch(0.7 0.18 290)"
      />
      <StatCardLg
        label="Called today"
        value={calledTodayCount}
        icon={<PhoneIcon className="h-4 w-4" />}
        spark={sparkCalls}
        sparkColor="oklch(0.65 0.18 260)"
      />
      <StatCardLg
        label="Connected"
        value={connectedTodayCount}
        sub={calledTodayCount > 0 ? `(${connectRate.toFixed(1)}%)` : undefined}
        icon={
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 4h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
          </svg>
        }
        spark={sparkConnected}
        sparkColor="oklch(0.75 0.16 180)"
      />
      <StatCardLg
        label="Meetings booked"
        value={meetings.length}
        icon={
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 3v4M16 3v4" />
          </svg>
        }
        spark={sparkMeetings}
        sparkColor="oklch(0.72 0.18 340)"
      />
    </div>
  );
}

// ---------- Prospect Table ----------

type ProspectStatus = {
  kind: "meeting" | "connected" | "attempted" | "sequence" | "new";
  label: string;
  tone: "violet" | "emerald" | "amber" | "blue" | "slate";
};

function deriveStatus(row: Row, agg: CallAgg | undefined): ProspectStatus {
  if (agg) {
    if (agg.meetings > 0) return { kind: "meeting", label: "Meeting", tone: "violet" };
    if (agg.connects > 0) return { kind: "connected", label: "Connected", tone: "emerald" };
    if (agg.attempts > 0) return { kind: "attempted", label: "Attempted", tone: "amber" };
  }
  const hasSeq = effectiveEmails(row).length > 0;
  if (hasSeq) return { kind: "sequence", label: "Sequence ready", tone: "blue" };
  return { kind: "new", label: "New", tone: "slate" };
}

function StatusPill({ status }: { status: ProspectStatus }) {
  const tones: Record<ProspectStatus["tone"], string> = {
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    slate: "border-white/10 bg-white/5 text-muted-foreground",
  };
  const dot: Record<ProspectStatus["tone"], string> = {
    violet: "bg-violet-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
    blue: "bg-blue-400",
    slate: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[status.tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status.tone]}`} />
      {status.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.max(0, Math.min(100, score));
  const color = score >= 75 ? "bg-emerald-400" : score >= 50 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-right text-sm tabular-nums text-foreground">{score}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CompanyMonogram({ name }: { name: string | null }) {
  if (!name) return <div className="h-7 w-7 rounded-md bg-white/5" />;
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
      style={{ background: `oklch(0.55 0.15 ${hue})` }}
    >
      {letter}
    </div>
  );
}

function ProspectAvatar({ first, last }: { first: string | null; last: string | null }) {
  const initials = `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "—";
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/20 text-[11px] font-semibold text-foreground">
      {initials}
    </div>
  );
}

function LastTouchCell({ agg, row }: { agg: CallAgg | undefined; row: Row }) {
  if (agg && agg.lastStartedAt) {
    const outcome = agg.lastOutcome || (agg.lastStatus === "completed" ? "completed" : agg.lastStatus);
    return (
      <div className="flex items-center gap-1.5">
        <PhoneIcon className="h-3 w-3 text-muted-foreground" />
        <span className="text-sm text-foreground">{timeAgo(agg.lastStartedAt)}</span>
        {outcome ? <span className="text-xs text-muted-foreground">· {outcome}</span> : null}
      </div>
    );
  }
  if (effectiveEmails(row).length > 0) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Mail className="h-3 w-3" />
        Draft ready
      </div>
    );
  }
  return <span className="text-sm text-muted-foreground">Never</span>;
}

function ProspectTable({
  listId,
  rows,
  busy,
  onOpenRow,
  onGenerate,
  onRemove,
}: {
  listId: string;
  rows: Row[];
  busy: Set<string>;
  onOpenRow: (r: Row) => void;
  onGenerate: (leadId: string) => void;
  onRemove: (leadId: string) => void;
}) {
  const { data: calls } = useCampaignCalls(listId);
  const aggByLead = aggregateByLead(calls);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (leadId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.lead_id)));
  };

  const cols =
    "grid-cols-[36px_minmax(220px,1.4fr)_minmax(140px,1fr)_minmax(160px,1fr)_minmax(140px,0.9fr)_minmax(130px,0.9fr)_minmax(130px,0.9fr)_48px]";

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className={`grid ${cols} items-center gap-3 border-b border-white/5 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground`}>
        <div>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-3.5 w-3.5 cursor-pointer accent-[oklch(0.6_0.18_290)]"
            aria-label="Select all"
          />
        </div>
        <div>Name + title</div>
        <div>Company</div>
        <div>Contact</div>
        <div>Last touch</div>
        <div>Status</div>
        <div>Score</div>
        <div />
      </div>
      {rows.map((r) => {
        const name = [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ") || "—";
        const agg = aggByLead.get(r.lead_id);
        const status = deriveStatus(r, agg);
        const isBusy = busy.has(r.lead_id);
        return (
          <div
            key={r.lead_id}
            onClick={() => onOpenRow(r)}
            className={`grid ${cols} cursor-pointer items-center gap-3 border-b border-white/5 px-4 py-3 transition-colors last:border-b-0 hover:bg-white/[0.03]`}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.has(r.lead_id)}
                onChange={() => toggle(r.lead_id)}
                className="h-3.5 w-3.5 cursor-pointer accent-[oklch(0.6_0.18_290)]"
                aria-label={`Select ${name}`}
              />
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <ProspectAvatar first={r.lead?.first_name ?? null} last={r.lead?.last_name ?? null} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{name}</div>
                <div className="truncate text-xs text-muted-foreground">{r.lead?.title || "—"}</div>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <CompanyMonogram name={r.lead?.org_name ?? null} />
              <span className="truncate text-sm text-foreground">{r.lead?.org_name || "—"}</span>
            </div>
            <div className="min-w-0 text-sm">
              {r.lead?.phone ? (
                <div className="flex items-center gap-1.5 text-foreground">
                  <PhoneIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate tabular-nums">{r.lead.phone}</span>
                </div>
              ) : null}
              {r.lead?.email ? (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{r.lead.email}</span>
                </div>
              ) : null}
              {!r.lead?.phone && !r.lead?.email ? (
                <span className="text-muted-foreground">—</span>
              ) : null}
            </div>
            <LastTouchCell agg={agg} row={r} />
            <StatusPill status={status} />
            <ScoreBar score={r.score} />
            <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
              <ProspectRowMenu
                isBusy={isBusy}
                hasSeq={effectiveEmails(r).length > 0}
                onGenerate={() => onGenerate(r.lead_id)}
                onRemove={() => onRemove(r.lead_id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProspectRowMenu({
  isBusy,
  hasSeq,
  onGenerate,
  onRemove,
}: {
  isBusy: boolean;
  hasSeq: boolean;
  onGenerate: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground"
        aria-label="Row actions"
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-base leading-none">⋯</span>}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-lg border border-white/10 bg-[oklch(0.16_0.02_265)] py-1 shadow-xl"
        >
          <button
            onClick={() => {
              setOpen(false);
              onGenerate();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-white/5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {hasSeq ? "Regenerate sequence" : "Generate sequence"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-rose-300 hover:bg-rose-500/10"
          >
            <X className="h-3.5 w-3.5" />
            Remove from list
          </button>
        </div>
      )}
    </div>
  );
}
