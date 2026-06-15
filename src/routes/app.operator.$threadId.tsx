import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Database,
  FileCheck2,
  Globe2,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  approveOperatorBlueprint,
  createOperatorThread,
  deleteOperatorThread,
  getOperatorWorkspace,
  listOperatorThreads,
  pauseOperatorBlueprint,
  resumeOperatorBlueprint,
} from "@/lib/operator.functions";

export const Route = createFileRoute("/app/operator/$threadId")({
  component: OperatorPage,
  head: () => ({ meta: [{ title: "AI Campaign Operator — NexusAi" }] }),
});

type Blueprint = {
  id: string;
  version: number;
  offer_brief: string;
  strategy: any;
  guardrails: any;
  status: string;
  approved_at: string | null;
};

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
  const resumePlan = useServerFn(resumeOperatorBlueprint);
  const [input, setInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const workspaceQuery = useQuery({
    queryKey: ["operator-workspace", threadId],
    queryFn: () => getWorkspace({ data: { threadId } }),
  });
  const threadsQuery = useQuery({ queryKey: ["operator-threads"], queryFn: () => getThreads() });
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/operator/chat",
        prepareSendMessagesRequest: async ({ messages }) => {
          const { data } = await supabase.auth.getSession();
          const headers: Record<string, string> = {};
          if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
          return { body: { threadId, messages }, headers };
        },
      }),
    [threadId],
  );

  if (workspaceQuery.isLoading)
    return (
      <div className="grid h-[calc(100vh-2rem)] place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  if (!workspaceQuery.data)
    return (
      <div className="grid h-[calc(100vh-2rem)] place-items-center text-sm text-destructive">
        Could not load this Operator conversation.
      </div>
    );

  return (
    <OperatorWorkspace
      key={threadId}
      threadId={threadId}
      workspace={workspaceQuery.data}
      threads={threadsQuery.data?.threads ?? []}
      input={input}
      setInput={setInput}
      threadSearch={threadSearch}
      setThreadSearch={setThreadSearch}
      inputRef={inputRef}
      transport={transport}
      navigate={navigate}
      queryClient={queryClient}
      getWorkspace={getWorkspace}
      createThread={createThread}
      deleteThread={deleteThread}
      approvePlan={approvePlan}
      pausePlan={pausePlan}
      resumePlan={resumePlan}
    />
  );
}

function OperatorWorkspace(props: any) {
  const {
    threadId,
    workspace,
    threads,
    input,
    setInput,
    threadSearch,
    setThreadSearch,
    inputRef,
    transport,
    navigate,
    queryClient,
    createThread,
    deleteThread,
    approvePlan,
    pausePlan,
    resumePlan,
  } = props;
  const [blueprint, setBlueprint] = useState<Blueprint | null>(workspace.blueprint);
  const [events, setEvents] = useState<any[]>(workspace.events);
  const [actionBusy, setActionBusy] = useState(false);
  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: workspace.messages as UIMessage[],
    transport,
    onFinish: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operator-threads"] });
      const fresh = await props.getWorkspace?.({ data: { threadId } }).catch(() => null);
      if (fresh) {
        setBlueprint(fresh.blueprint);
        setEvents(fresh.events);
      }
      inputRef.current?.focus();
    },
    onError: (chatError) =>
      toast.error(
        chatError.message.includes("402")
          ? "AI credits are exhausted. Add workspace credits to continue."
          : chatError.message,
      ),
  });
  const busy = status === "submitted" || status === "streaming";
  const activeEvent = events.find((event: any) => event.status === "running") ?? null;
  const hasActiveWork = busy || actionBusy || Boolean(activeEvent) || blueprint?.status === "running";
  useEffect(() => {
    inputRef.current?.focus();
  }, [threadId, status, inputRef]);
  useEffect(() => {
    if (!hasActiveWork) return;
    void refreshWorkspace();
    const refresh = window.setInterval(() => {
      void refreshWorkspace();
    }, 1500);
    return () => window.clearInterval(refresh);
  }, [hasActiveWork, threadId]);

  const refreshWorkspace = async () => {
    const data = await queryClient.fetchQuery({
      queryKey: ["operator-workspace", threadId],
      queryFn: () => props.getWorkspace({ data: { threadId } }),
    });
    setBlueprint(data.blueprint);
    setEvents(data.events);
  };
  const submit = async ({ text }: { text: string }) => {
    const textToSend = text.trim() || input.trim();
    if (!textToSend || busy) return;
    setInput("");
    await sendMessage({ text: textToSend });
  };
  const filteredThreads = threads.filter((thread: any) =>
    thread.title.toLowerCase().includes(threadSearch.toLowerCase()),
  );

  return (
    <div className="grid h-[calc(100vh-2rem)] min-h-[720px] grid-cols-[220px_minmax(380px,1fr)_minmax(320px,0.9fr)] overflow-hidden rounded-2xl border bg-card/40 shadow-2xl backdrop-blur-xl">
      <aside className="flex min-h-0 flex-col border-r bg-background/20 p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Operator
            </p>
            <p className="text-[11px] text-muted-foreground">Campaign workspaces</p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={async () => {
              const { thread } = await createThread({ data: { title: "New campaign plan" } });
              await queryClient.invalidateQueries({ queryKey: ["operator-threads"] });
              navigate({ to: "/app/operator/$threadId", params: { threadId: thread.id } });
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={threadSearch}
            onChange={(event) => setThreadSearch(event.target.value)}
            placeholder="Search plans"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filteredThreads.map((thread: any) => (
            <div
              key={thread.id}
              className={`group flex items-center rounded-lg ${thread.id === threadId ? "bg-primary/15" : "hover:bg-muted/60"}`}
            >
              <Button
                variant="ghost"
                className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left text-xs"
                onClick={() =>
                  navigate({ to: "/app/operator/$threadId", params: { threadId: thread.id } })
                }
              >
                <span className="truncate">{thread.title}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100"
                onClick={async () => {
                  await deleteThread({ data: { id: thread.id } });
                  const remaining = threads.filter((item: any) => item.id !== thread.id);
                  await queryClient.invalidateQueries({ queryKey: ["operator-threads"] });
                  if (thread.id === threadId) {
                    const next =
                      remaining[0] ??
                      (await createThread({ data: { title: "New campaign plan" } })).thread;
                    navigate({ to: "/app/operator/$threadId", params: { threadId: next.id } });
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border bg-muted/25 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" /> Approval protected
          </div>
          <p className="text-[10px] leading-4 text-muted-foreground">
            Research and planning are automatic. Outreach and spending require your approved plan.
          </p>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col border-r">
        <header className="flex h-16 items-center justify-between border-b px-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gradient-aurora)] shadow-lg">
              <Bot className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">NexusAi Campaign Operator</h1>
              <p className="text-[11px] text-muted-foreground">
                Strategy, execution and optimization toward meetings
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Online
          </Badge>
        </header>
        <Conversation className="min-h-0">
          <ConversationContent className="gap-6 px-5 py-6">
            {messages.length === 0 && (
              <div className="mx-auto mt-16 max-w-xl text-center">
                <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--gradient-aurora)] shadow-[var(--shadow-glow)]">
                  <Target className="h-6 w-6 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">What do you want to sell?</h2>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                  Give me the offer in plain English. Watch the live activity feed while I inspect
                  your setup, research the market, search your leads, and build the campaign map.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "I sell contact-center solutions",
                    "Build a campaign for my product info",
                    "Review my campaigns and find the next opportunity",
                  ].map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message: UIMessage) => (
              <Message from={message.role} key={message.id}>
                <MessageContent
                  className={
                    message.role === "user" ? "bg-primary text-primary-foreground" : undefined
                  }
                >
                  {message.role === "assistant" && (
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
                      <Bot className="h-3.5 w-3.5" /> Operator
                    </div>
                  )}
                  {message.parts.map((part: any, index: number) =>
                    part.type === "text" ? (
                      <MessageResponse key={index} isAnimating={busy}>
                        {part.text}
                      </MessageResponse>
                    ) : part.type.startsWith("tool-") || part.type === "dynamic-tool" ? (
                      <OperatorToolActivity key={index} part={part} />
                    ) : null,
                  )}
                </MessageContent>
              </Message>
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-xs">
                <Zap className="h-3.5 w-3.5 animate-pulse text-primary" />
                <Shimmer>Operator is deciding the next action…</Shimmer>
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {error.message}
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t p-4">
          <PromptInput onSubmit={submit} className="rounded-2xl bg-background/60 shadow-lg">
            <PromptInputTextarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Tell the Operator what to sell or what to investigate…"
              disabled={busy}
              className="min-h-16"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!input.trim() && !busy} />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Every search, database check, and campaign action is shown live. Full autonomy is enabled
            for your Operator.
          </p>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto bg-background/15 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Command center
            </p>
            <h2 className="mt-1 text-base font-semibold">Campaign blueprint</h2>
          </div>
          {blueprint && (
            <Badge variant={blueprint.status === "draft" ? "secondary" : "default"}>
              {blueprint.status}
            </Badge>
          )}
        </div>
        {!blueprint ? (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <FileCheck2 className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No blueprint yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              The Operator will build it after learning enough about your offer and capacity.
            </p>
          </div>
        ) : (
          <BlueprintPanel
            blueprint={blueprint}
            actionBusy={actionBusy}
            approve={async () => {
              setActionBusy(true);
              try {
                await approvePlan({ data: { blueprintId: blueprint.id } });
                toast.success("Campaign plan approved");
                await refreshWorkspace();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Approval failed");
              } finally {
                setActionBusy(false);
              }
            }}
            pause={async () => {
              setActionBusy(true);
              try {
                await pausePlan({ data: { blueprintId: blueprint.id } });
                toast.success("Operator paused");
                await refreshWorkspace();
              } finally {
                setActionBusy(false);
              }
            }}
            resume={async () => {
              setActionBusy(true);
              try {
                await resumePlan({ data: { blueprintId: blueprint.id } });
                toast.success("Operator resumed");
                await refreshWorkspace();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Resume failed");
              } finally {
                setActionBusy(false);
              }
            }}
          />
        )}
        <LiveOperatorScreen event={activeEvent} chatBusy={busy} />
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Live activity</h3>
            </div>
            {hasActiveWork && (
              <Badge variant="outline" className="gap-1 text-[9px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Watching
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            {events.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Research, lead searches, approvals, and campaign changes will appear here as they
                happen.
              </p>
            ) : (
              events.map((event: any) => (
                <div key={event.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-start gap-2">
                    {event.status === "completed" ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 text-accent" />
                    ) : event.status === "approval_required" ? (
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 text-primary" />
                    ) : event.status === "running" ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Activity className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{event.title}</p>
                      {event.details?.summary && (
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                          {event.details.summary}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

const toolPresentation: Record<string, { title: string; icon: typeof Activity }> = {
  inspect_portfolio: { title: "Inspecting your sales workspace", icon: Database },
  research_market: { title: "Researching the market online", icon: Globe2 },
  estimate_audience: { title: "Searching your lead database", icon: Search },
  create_campaign_blueprint: { title: "Building the campaign blueprint", icon: FileCheck2 },
};

function OperatorToolActivity({ part }: { part: ToolPart }) {
  const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.replace("tool-", "");
  const presentation = toolPresentation[toolName] ?? {
    title: toolName.replaceAll("_", " "),
    icon: Activity,
  };
  const Icon = presentation.icon;
  const toolPart = part as any;
  return (
    <Tool defaultOpen={false} className="my-2 overflow-hidden bg-muted/20">
      <ToolHeader
        type={part.type as any}
        state={part.state}
        toolName={part.type === "dynamic-tool" ? part.toolName : (undefined as never)}
        title={presentation.title}
      />
      <ToolContent>
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-4 w-4 text-accent" /> This is a live, verified Operator action.
        </div>
        {toolPart.input && <ToolInput input={toolPart.input} />}
        {(toolPart.output || toolPart.errorText) && (
          <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}

function BlueprintPanel({
  blueprint,
  actionBusy,
  approve,
  pause,
  resume,
}: {
  blueprint: Blueprint;
  actionBusy: boolean;
  approve: () => void;
  pause: () => void;
  resume: () => void;
}) {
  const strategy = blueprint.strategy ?? {};
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-muted/20 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">Offer</p>
        <p className="mt-2 text-sm leading-5">{blueprint.offer_brief}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Plays", strategy.plays?.length ?? 0],
          ["Emails/day", strategy.schedule?.dailyEmails ?? 0],
          ["Credits", strategy.estimatedCredits ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border bg-muted/20 p-2 text-center">
            <p className="text-base font-semibold">{value}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      {strategy.plays?.map((play: any, index: number) => (
        <div key={play.name ?? index} className="rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{play.name}</p>
            <Badge variant="outline" className="text-[9px]">
              {Number(play.estimatedAudience ?? 0).toLocaleString()} leads
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{play.audience}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {play.channels?.map((channel: string) => (
              <Badge key={channel} variant="secondary" className="text-[9px]">
                {channel}
              </Badge>
            ))}
          </div>
        </div>
      ))}
      {strategy.risks?.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <p className="mb-2 text-xs font-semibold">Risks & dependencies</p>
          <ul className="space-y-1 text-[11px] leading-4 text-muted-foreground">
            {[...(strategy.dependencies ?? []), ...(strategy.risks ?? [])]
              .slice(0, 6)
              .map((item: string) => (
                <li key={item}>• {item}</li>
              ))}
          </ul>
        </div>
      )}
      {strategy.citations?.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold">Research sources</p>
          <div className="space-y-1">
            {strategy.citations.slice(0, 6).map((source: any) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-[11px] text-accent hover:underline"
              >
                {source.title}
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="sticky bottom-0 rounded-xl border bg-background/90 p-3 backdrop-blur-xl">
        {blueprint.status === "draft" ? (
          <Button className="w-full gap-2" disabled={actionBusy} onClick={approve}>
            {actionBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileCheck2 className="h-4 w-4" />
            )}{" "}
            Approve & build
          </Button>
        ) : blueprint.status === "paused" ? (
          <Button className="w-full gap-2" disabled={actionBusy} onClick={resume}>
            {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume Operator
          </Button>
        ) : blueprint.status === "completed" ? (
          <Button className="w-full gap-2" variant="outline" disabled>
            <Check className="h-4 w-4" /> Campaign build complete
          </Button>
        ) : (
          <Button
            className="w-full gap-2"
            variant="outline"
            disabled={actionBusy}
            onClick={pause}
          >
            <Pause className="h-4 w-4" /> Pause Operator
          </Button>
        )}
        <p className="mt-2 text-center text-[9px] leading-4 text-muted-foreground">
          Full autonomy lets the Operator execute its plan immediately while preserving validation,
          deliverability, compliance, and stop-loss safeguards.
        </p>
      </div>
    </div>
  );
}
