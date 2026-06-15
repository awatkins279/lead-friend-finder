import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Activity, ArrowUp, Bot, Check, CircleAlert, Clock3, FileCheck2, Loader2, Pause, Plus, Search, ShieldCheck, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { approveOperatorBlueprint, createOperatorThread, deleteOperatorThread, getOperatorWorkspace, listOperatorThreads, pauseOperatorBlueprint } from "@/lib/operator.functions";

export const Route = createFileRoute("/app/operator/$threadId")({
  component: OperatorPage,
  head: () => ({ meta: [{ title: "AI Campaign Operator — NexusAi" }] }),
});

type Blueprint = { id: string; version: number; offer_brief: string; strategy: any; guardrails: any; status: string; approved_at: string | null };

function OperatorPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getWorkspace = useServerFn(getOperatorWorkspace);
  const getThreads = useServerFn(listOperatorThreads);
  const createThread = useServerFn(createOperatorThread);
  const deleteThread = useServerFn(deleteOperatorThread);
  const approvePlan = useServerFn(approveOperatorBlueprint);
  const pausePlan = useServerFn(pauseOperatorBlueprint);
  const [input, setInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const workspaceQuery = useQuery({ queryKey: ["operator-workspace", threadId], queryFn: () => getWorkspace({ data: { threadId } }) });
  const threadsQuery = useQuery({ queryKey: ["operator-threads"], queryFn: () => getThreads() });
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/operator/chat",
    prepareSendMessagesRequest: async ({ messages }) => {
      const { data } = await supabase.auth.getSession();
      return { body: { threadId, messages }, headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {} };
    },
  }), [threadId]);

  if (workspaceQuery.isLoading) return <div className="grid h-[calc(100vh-2rem)] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!workspaceQuery.data) return <div className="grid h-[calc(100vh-2rem)] place-items-center text-sm text-destructive">Could not load this Operator conversation.</div>;

  return <OperatorWorkspace key={threadId} threadId={threadId} workspace={workspaceQuery.data} threads={threadsQuery.data?.threads ?? []} input={input} setInput={setInput} threadSearch={threadSearch} setThreadSearch={setThreadSearch} inputRef={inputRef} transport={transport} navigate={navigate} queryClient={queryClient} getWorkspace={getWorkspace} createThread={createThread} deleteThread={deleteThread} approvePlan={approvePlan} pausePlan={pausePlan} />;
}

function OperatorWorkspace(props: any) {
  const { threadId, workspace, threads, input, setInput, threadSearch, setThreadSearch, inputRef, transport, navigate, queryClient, createThread, deleteThread, approvePlan, pausePlan } = props;
  const [blueprint, setBlueprint] = useState<Blueprint | null>(workspace.blueprint);
  const [events, setEvents] = useState<any[]>(workspace.events);
  const [actionBusy, setActionBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: workspace.messages as UIMessage[],
    transport,
    onFinish: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operator-threads"] });
      const fresh = await props.getWorkspace?.({ data: { threadId } }).catch(() => null);
      if (fresh) { setBlueprint(fresh.blueprint); setEvents(fresh.events); }
      inputRef.current?.focus();
    },
    onError: (chatError) => toast.error(chatError.message.includes("402") ? "AI credits are exhausted. Add workspace credits to continue." : chatError.message),
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, status]);
  useEffect(() => { inputRef.current?.focus(); }, [threadId, status, inputRef]);

  const refreshWorkspace = async () => {
    const data = await queryClient.fetchQuery({ queryKey: ["operator-workspace", threadId], queryFn: () => props.getWorkspace({ data: { threadId } }) });
    setBlueprint(data.blueprint); setEvents(data.events);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  };
  const filteredThreads = threads.filter((thread: any) => thread.title.toLowerCase().includes(threadSearch.toLowerCase()));

  return (
    <div className="grid h-[calc(100vh-2rem)] min-h-[720px] grid-cols-[220px_minmax(380px,1fr)_minmax(320px,0.9fr)] overflow-hidden rounded-2xl border bg-card/40 shadow-2xl backdrop-blur-xl">
      <aside className="flex min-h-0 flex-col border-r bg-background/20 p-3">
        <div className="mb-3 flex items-center justify-between px-1"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Operator</p><p className="text-[11px] text-muted-foreground">Campaign workspaces</p></div><Button size="icon" variant="ghost" onClick={async () => { const { thread } = await createThread({ data: { title: "New campaign plan" } }); await queryClient.invalidateQueries({ queryKey: ["operator-threads"] }); navigate({ to: "/app/operator/$threadId", params: { threadId: thread.id } }); }}><Plus className="h-4 w-4" /></Button></div>
        <div className="relative mb-3"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Search plans" className="h-9 pl-8 text-xs" /></div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filteredThreads.map((thread: any) => <div key={thread.id} className={`group flex items-center rounded-lg ${thread.id === threadId ? "bg-primary/15" : "hover:bg-muted/60"}`}><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left text-xs" onClick={() => navigate({ to: "/app/operator/$threadId", params: { threadId: thread.id } })}><span className="truncate">{thread.title}</span></Button><Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100" onClick={async () => { await deleteThread({ data: { id: thread.id } }); const remaining = threads.filter((item: any) => item.id !== thread.id); await queryClient.invalidateQueries({ queryKey: ["operator-threads"] }); if (thread.id === threadId) { const next = remaining[0] ?? (await createThread({ data: { title: "New campaign plan" } })).thread; navigate({ to: "/app/operator/$threadId", params: { threadId: next.id } }); } }}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}
        </div>
        <div className="mt-3 rounded-xl border bg-muted/25 p-3"><div className="mb-1 flex items-center gap-2 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-accent" /> Approval protected</div><p className="text-[10px] leading-4 text-muted-foreground">Research and planning are automatic. Outreach and spending require your approved plan.</p></div>
      </aside>

      <section className="flex min-h-0 flex-col border-r">
        <header className="flex h-16 items-center justify-between border-b px-5"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gradient-aurora)] shadow-lg"><Bot className="h-4 w-4 text-primary-foreground" /></div><div><h1 className="text-sm font-semibold">NexusAi Campaign Operator</h1><p className="text-[11px] text-muted-foreground">Strategy, execution and optimization toward meetings</p></div></div><Badge variant="outline" className="gap-1.5 text-[10px]"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Online</Badge></header>
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {messages.length === 0 && <div className="mx-auto mt-16 max-w-xl text-center"><div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--gradient-aurora)] shadow-[var(--shadow-glow)]"><Target className="h-6 w-6 text-primary-foreground" /></div><h2 className="text-2xl font-semibold tracking-tight">What do you want to sell?</h2><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Give me the offer in plain English. I’ll inspect your setup, research the market, map audiences and channels, estimate capacity, then present the full campaign for approval.</p><div className="mt-6 flex flex-wrap justify-center gap-2">{["I sell contact-center solutions", "Build a campaign for my product info", "Review my campaigns and find the next opportunity"].map((prompt) => <Button key={prompt} variant="outline" size="sm" onClick={() => setInput(prompt)}>{prompt}</Button>)}</div></div>}
          {messages.map((message: UIMessage) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={message.role === "user" ? "max-w-[82%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground" : "max-w-[92%] text-sm leading-6 text-foreground"}>{message.role === "assistant" && <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary"><Bot className="h-3.5 w-3.5" /> Operator</div>}{message.parts.map((part: any, index: number) => part.type === "text" ? <div key={index} className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-accent dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div> : part.type.startsWith("tool-") || part.type === "dynamic-tool" ? <div key={index} className="my-2 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5 text-accent" /><span>{String(part.type).replace("tool-", "").replaceAll("_", " ")}</span><Badge variant="outline" className="ml-auto text-[9px]">{part.state?.replaceAll("-", " ") ?? "working"}</Badge></div> : null)}</div></div>)}
          {status === "submitted" && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Operator is assessing the next move…</div>}
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error.message}</div>}
        </div>
        <form onSubmit={submit} className="border-t p-4"><div className="flex items-end gap-2 rounded-2xl border bg-background/60 p-2 shadow-lg focus-within:ring-1 focus-within:ring-primary"><Input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Describe your offer, market, or what you want the Operator to do…" className="min-h-11 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0" disabled={busy} /><Button type="submit" size="icon" disabled={!input.trim() || busy} className="h-10 w-10 shrink-0 rounded-xl">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button></div><p className="mt-2 text-center text-[10px] text-muted-foreground">Plans use live account data and cited research. Review all assumptions before approval.</p></form>
      </section>

      <aside className="min-h-0 overflow-y-auto bg-background/15 p-4">
        <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Command center</p><h2 className="mt-1 text-base font-semibold">Campaign blueprint</h2></div>{blueprint && <Badge variant={blueprint.status === "draft" ? "secondary" : "default"}>{blueprint.status}</Badge>}</div>
        {!blueprint ? <div className="rounded-xl border border-dashed p-6 text-center"><FileCheck2 className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No blueprint yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The Operator will build it after learning enough about your offer and capacity.</p></div> : <BlueprintPanel blueprint={blueprint} actionBusy={actionBusy} approve={async () => { setActionBusy(true); try { await approvePlan({ data: { blueprintId: blueprint.id } }); toast.success("Campaign plan approved"); await refreshWorkspace(); } catch (err) { toast.error(err instanceof Error ? err.message : "Approval failed"); } finally { setActionBusy(false); } }} pause={async () => { setActionBusy(true); try { await pausePlan({ data: { blueprintId: blueprint.id } }); toast.success("Operator paused"); await refreshWorkspace(); } finally { setActionBusy(false); } }} />}
        <div className="mt-5"><div className="mb-3 flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Execution timeline</h3></div><div className="space-y-2">{events.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Research, approvals and actions will appear here.</p> : events.map((event: any) => <div key={event.id} className="rounded-lg border bg-muted/20 p-3"><div className="flex items-start gap-2">{event.status === "completed" ? <Check className="mt-0.5 h-3.5 w-3.5 text-accent" /> : event.status === "approval_required" ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 text-primary" /> : <Activity className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />}<div className="min-w-0"><p className="text-xs font-medium">{event.title}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p></div></div></div>)}</div></div>
      </aside>
    </div>
  );
}

function BlueprintPanel({ blueprint, actionBusy, approve, pause }: { blueprint: Blueprint; actionBusy: boolean; approve: () => void; pause: () => void }) {
  const strategy = blueprint.strategy ?? {};
  return <div className="space-y-3"><div className="rounded-xl border bg-muted/20 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Offer</p><p className="mt-2 text-sm leading-5">{blueprint.offer_brief}</p></div><div className="grid grid-cols-3 gap-2">{[["Plays", strategy.plays?.length ?? 0],["Emails/day", strategy.schedule?.dailyEmails ?? 0],["Credits", strategy.estimatedCredits ?? 0]].map(([label,value]) => <div key={String(label)} className="rounded-lg border bg-muted/20 p-2 text-center"><p className="text-base font-semibold">{value}</p><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p></div>)}</div>{strategy.plays?.map((play: any, index: number) => <div key={play.name ?? index} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{play.name}</p><Badge variant="outline" className="text-[9px]">{Number(play.estimatedAudience ?? 0).toLocaleString()} leads</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{play.audience}</p><div className="mt-2 flex flex-wrap gap-1">{play.channels?.map((channel: string) => <Badge key={channel} variant="secondary" className="text-[9px]">{channel}</Badge>)}</div></div>)}{strategy.risks?.length > 0 && <div className="rounded-xl border border-primary/20 bg-primary/5 p-3"><p className="mb-2 text-xs font-semibold">Risks & dependencies</p><ul className="space-y-1 text-[11px] leading-4 text-muted-foreground">{[...(strategy.dependencies ?? []), ...(strategy.risks ?? [])].slice(0, 6).map((item: string) => <li key={item}>• {item}</li>)}</ul></div>}{strategy.citations?.length > 0 && <div><p className="mb-2 text-xs font-semibold">Research sources</p><div className="space-y-1">{strategy.citations.slice(0, 6).map((source: any) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-accent hover:underline">{source.title}</a>)}</div></div>}<div className="sticky bottom-0 rounded-xl border bg-background/90 p-3 backdrop-blur-xl">{blueprint.status === "draft" ? <Button className="w-full gap-2" disabled={actionBusy} onClick={approve}>{actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Approve & build</Button> : <Button className="w-full gap-2" variant="outline" disabled={actionBusy || blueprint.status === "paused"} onClick={pause}><Pause className="h-4 w-4" /> Pause Operator</Button>}<p className="mt-2 text-center text-[9px] leading-4 text-muted-foreground">Approval authorizes work only inside the displayed limits. New audiences, channels or higher volume require another approval.</p></div></div>;
}