import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Inbox,
  Search,
  Archive,
  Star,
  Send,
  Sparkles,
  Mail,
  MailOpen,
  Filter as FilterIcon,
  RefreshCcw,
  ChevronRight,
  TrendingUp,
  Calendar,
  X,
  Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listConversations,
  getConversation,
  setConversationStatus,
  setConversationIntent,
  saveDraftReply,
  approveAndSend,
  generateAgentReply,
  getInboxAnalytics,
  listInboxFilterOptions,
} from "@/lib/inbox.functions";

export const Route = createFileRoute("/app/inbox")({
  component: InboxPage,
  head: () => ({ meta: [{ title: "Inbox — NexusAi" }] }),
});

const INTENT_OPTIONS = [
  {
    value: "interested",
    label: "Interested",
    color: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  },
  {
    value: "objection",
    label: "Objection",
    color: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  },
  {
    value: "not_interested",
    label: "Not interested",
    color: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  },
  { value: "question", label: "Question", color: "bg-sky-500/15 text-sky-700 border-sky-500/30" },
  {
    value: "meeting_booked",
    label: "Meeting booked",
    color: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  },
  {
    value: "ooo",
    label: "Out of office",
    color: "bg-zinc-500/15 text-zinc-700 border-zinc-500/30",
  },
  {
    value: "unsubscribe",
    label: "Unsubscribe",
    color: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  },
  { value: "other", label: "Other", color: "bg-zinc-500/15 text-zinc-700 border-zinc-500/30" },
];

const DATE_PRESETS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "month", label: "Last month" },
  { value: "year", label: "Last year" },
  { value: "yearbefore", label: "Year before" },
];

function rangeFor(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  if (preset === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: iso(d) };
  }
  if (preset === "7d") return { from: iso(new Date(now.getTime() - 7 * 86400000)) };
  if (preset === "30d") return { from: iso(new Date(now.getTime() - 30 * 86400000)) };
  if (preset === "month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from: iso(from), to: iso(to) };
  }
  if (preset === "year") {
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    return { from: iso(from), to: iso(to) };
  }
  if (preset === "yearbefore") {
    const from = new Date(now.getFullYear() - 2, 0, 1);
    const to = new Date(now.getFullYear() - 2, 11, 31, 23, 59, 59);
    return { from: iso(from), to: iso(to) };
  }
  return {};
}

type Conversation = {
  id: string;
  lead_email: string;
  lead_name: string | null;
  company: string | null;
  subject: string | null;
  last_message_at: string;
  last_direction: string;
  unread_count: number;
  intent: string | null;
  status: string;
  list_id: string | null;
  email_account_id: string | null;
  agent_id: string | null;
  lists: { name: string } | null;
  email_accounts: { email_address: string } | null;
  sdr_agents: { name: string; sdr_display_name: string | null } | null;
};

type Message = {
  id: string;
  direction: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  ai_generated: boolean;
  status: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function intentBadge(intent: string | null) {
  const opt = INTENT_OPTIONS.find((o) => o.value === intent);
  if (!opt) return null;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${opt.color}`}>
      {opt.label}
    </Badge>
  );
}

function InboxPage() {
  const [folder, setFolder] = useState<"all" | "open" | "needs_approval" | "archived">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [campaign, setCampaign] = useState<string>("all");
  const [account, setAccount] = useState<string>("all");
  const [intent, setIntent] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<string>("all");
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filterOptions, setFilterOptions] = useState<{
    campaigns: { id: string; name: string }[];
    accounts: { id: string; email_address: string }[];
  }>({ campaigns: [], accounts: [] });
  const [analytics, setAnalytics] = useState<{
    total: number;
    meetings: number;
    unsubscribes: number;
    intent_counts: Record<string, number>;
    campaigns: { id: string; name: string; count: number }[];
  } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ conversation: Conversation; messages: Message[] } | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [generating, setGenerating] = useState(false);

  const listFn = useServerFn(listConversations);
  const getFn = useServerFn(getConversation);
  const statusFn = useServerFn(setConversationStatus);
  const intentFn = useServerFn(setConversationIntent);
  const draftFn = useServerFn(saveDraftReply);
  const sendFn = useServerFn(approveAndSend);
  const generateFn = useServerFn(generateAgentReply);
  const analyticsFn = useServerFn(getInboxAnalytics);
  const optionsFn = useServerFn(listInboxFilterOptions);

  const filterPayload = useMemo(() => {
    const range = rangeFor(datePreset);
    return {
      status:
        folder === "all" ? ("all" as const) : (folder as "open" | "needs_approval" | "archived"),
      unread_only: unreadOnly,
      campaign_ids: campaign === "all" ? undefined : [campaign],
      account_ids: account === "all" ? undefined : [account],
      intents: intent === "all" ? undefined : [intent],
      date_from: range.from,
      date_to: range.to,
      search: search.trim() || undefined,
    };
  }, [folder, unreadOnly, campaign, account, intent, datePreset, search]);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await listFn({ data: filterPayload });
      setConversations(r.conversations as Conversation[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingList(false);
    }
  };

  const loadAnalytics = async () => {
    try {
      const r = await analyticsFn({ data: filterPayload });
      setAnalytics(r);
    } catch {
      // non-fatal
    }
  };

  const loadOptions = async () => {
    try {
      const r = await optionsFn({});
      setFilterOptions(r);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    if (demoMode) return;
    loadList();
    loadAnalytics();
  }, [filterPayload, demoMode]);

  // Realtime: refresh on changes
  useEffect(() => {
    if (demoMode) return;
    const ch = supabase
      .channel("inbox-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "sdr_conversations" }, () =>
        loadList(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [demoMode, filterPayload]);

  const openThread = async (id: string) => {
    setSelectedId(id);
    setLoadingThread(true);
    setDraft("");
    if (demoMode) {
      const c = DEMO_CONVOS.find((x) => x.id === id);
      if (c) setThread({ conversation: c, messages: DEMO_MESSAGES[id] ?? [] });
      setLoadingThread(false);
      return;
    }
    try {
      const r = await getFn({ data: { id } });
      setThread({
        conversation: r.conversation as Conversation,
        messages: r.messages as Message[],
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingThread(false);
    }
  };

  const archive = async (id: string) => {
    if (demoMode) return;
    try {
      await statusFn({ data: { id, status: "archived" } });
      toast.success("Archived");
      setSelectedId(null);
      setThread(null);
      loadList();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const changeIntent = async (id: string, value: string) => {
    if (demoMode) return;
    try {
      await intentFn({ data: { id, intent: value } });
      toast.success("Updated");
      loadList();
      if (thread?.conversation.id === id) {
        setThread({ ...thread, conversation: { ...thread.conversation, intent: value } });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveAndSend = async () => {
    if (!thread || !draft.trim()) return;
    if (demoMode) {
      toast.info("Connect an inbox to actually send replies.");
      return;
    }
    try {
      const r = await draftFn({ data: { conversation_id: thread.conversation.id, body: draft } });
      await sendFn({ data: { message_id: r.id } });
      toast.success("Reply sent ✓");
      setDraft("");
      openThread(thread.conversation.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const generateDraft = async () => {
    if (!thread) return;
    if (demoMode) {
      toast.info("This is sample data — open a real conversation to draft with AI.");
      return;
    }
    setGenerating(true);
    try {
      const r = await generateFn({ data: { conversation_id: thread.conversation.id } });
      setDraft(r.reply);
      if (r.needs_handoff) {
        toast.warning(
          `⚠ Flagged for your review${r.handoff_reason ? `: ${r.handoff_reason}` : ""}. Read carefully before sending.`,
        );
      } else if (r.confidence < 70) {
        toast.warning(
          `Draft ready, but the AI is only ${r.confidence}% confident — double-check it before sending.`,
        );
      } else {
        toast.success(
          `Draft ready · ${r.confidence}% confident · grounded on ${r.knowledge_used} knowledge chunk(s)`,
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const data = demoMode ? DEMO_CONVOS : conversations;
  const noAccounts = filterOptions.accounts.length === 0;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-6 py-3">
        <div className="flex items-center gap-3">
          <Inbox className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Unified Inbox</h1>
          {noAccounts && !demoMode && (
            <Badge variant="outline" className="gap-1 text-amber-600">
              No inboxes connected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={demoMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDemoMode((v) => !v);
              setSelectedId(null);
              setThread(null);
            }}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {demoMode ? "Demo on" : "Load sample data"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              loadList();
              loadAnalytics();
            }}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Analytics strip */}
      {analyticsOpen && (
        <div className="border-b bg-muted/30 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Analytics
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAnalyticsOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <AnalyticsStrip data={demoMode ? DEMO_ANALYTICS : analytics} />
        </div>
      )}
      {!analyticsOpen && (
        <button
          onClick={() => setAnalyticsOpen(true)}
          className="border-b bg-muted/30 px-6 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50"
        >
          <TrendingUp className="mr-1 inline h-3 w-3" /> Show analytics
        </button>
      )}

      {/* Body — three panes */}
      <div className="flex min-h-0 flex-1">
        {/* Left: folders + filters */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r bg-background p-3">
          <div className="space-y-1">
            {[
              { id: "all", label: "All", icon: Inbox },
              { id: "open", label: "Open", icon: MailOpen },
              { id: "needs_approval", label: "Needs approval", icon: Star },
              { id: "archived", label: "Archived", icon: Archive },
            ].map((f) => {
              const Icon = f.icon;
              const active = folder === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFolder(f.id as typeof folder)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t pt-3">
            <label className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              Unread only
            </label>
          </div>

          <div className="mt-3 space-y-2 border-t pt-3">
            <div className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground">
              <FilterIcon className="h-3 w-3" /> Filters
            </div>

            <FilterSelect
              label="Campaign"
              value={campaign}
              onChange={setCampaign}
              options={[
                { value: "all", label: "All campaigns" },
                ...filterOptions.campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <FilterSelect
              label="Account"
              value={account}
              onChange={setAccount}
              options={[
                { value: "all", label: "All accounts" },
                ...filterOptions.accounts.map((a) => ({ value: a.id, label: a.email_address })),
              ]}
            />
            <FilterSelect
              label="Intent"
              value={intent}
              onChange={setIntent}
              options={[
                { value: "all", label: "All intents" },
                ...INTENT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
              ]}
            />
            <FilterSelect
              label="Date"
              value={datePreset}
              onChange={setDatePreset}
              options={DATE_PRESETS}
              icon={<Calendar className="h-3 w-3" />}
            />
          </div>
        </aside>

        {/* Middle: thread list */}
        <section className="flex w-[380px] shrink-0 flex-col border-r bg-background">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search subject, sender, company…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList && !demoMode ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : data.length === 0 ? (
              <EmptyList noAccounts={noAccounts} onTryDemo={() => setDemoMode(true)} />
            ) : (
              data.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  active={selectedId === c.id}
                  onClick={() => openThread(c.id)}
                />
              ))
            )}
          </div>
        </section>

        {/* Right: thread view */}
        <section className="min-w-0 flex-1 overflow-y-auto bg-muted/20">
          {!thread ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          ) : (
            <ThreadView
              thread={thread}
              draft={draft}
              setDraft={setDraft}
              onArchive={() => archive(thread.conversation.id)}
              onChangeIntent={(v) => changeIntent(thread.conversation.id, v)}
              onSend={saveAndSend}
              onGenerate={generateDraft}
              generating={generating}
              loading={loadingThread}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ConversationRow({
  c,
  active,
  onClick,
}: {
  c: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const unread = c.unread_count > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full border-b px-3 py-3 text-left transition-colors ${
        active
          ? "bg-accent"
          : unread
            ? "bg-background hover:bg-accent/40"
            : "bg-background hover:bg-accent/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`truncate text-sm ${unread ? "font-semibold" : "font-normal"}`}>
          {c.lead_name || c.lead_email}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {timeAgo(c.last_message_at)}
        </span>
      </div>
      <div
        className={`mt-0.5 truncate text-xs ${unread ? "font-medium" : "text-muted-foreground"}`}
      >
        {c.subject || "(no subject)"}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {intentBadge(c.intent)}
        {c.lists?.name && (
          <Badge variant="secondary" className="text-[10px]">
            {c.lists.name}
          </Badge>
        )}
        {c.email_accounts?.email_address && (
          <span className="truncate text-[10px] text-muted-foreground">
            via {c.email_accounts.email_address}
          </span>
        )}
      </div>
    </button>
  );
}

function ThreadView({
  thread,
  draft,
  setDraft,
  onArchive,
  onChangeIntent,
  onSend,
  onGenerate,
  generating,
  loading,
}: {
  thread: { conversation: Conversation; messages: Message[] };
  draft: string;
  setDraft: (v: string) => void;
  onArchive: () => void;
  onChangeIntent: (v: string) => void;
  onSend: () => void;
  onGenerate: () => void;
  generating: boolean;
  loading: boolean;
}) {
  const c = thread.conversation;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{c.subject || "(no subject)"}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {c.lead_name ? `${c.lead_name} · ` : ""}
              {c.lead_email}
              {c.company ? ` · ${c.company}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.lists?.name && (
                <Badge variant="secondary" className="text-[10px]">
                  Campaign: {c.lists.name}
                </Badge>
              )}
              {c.sdr_agents?.name && (
                <Badge variant="outline" className="text-[10px]">
                  Agent: {c.sdr_agents.sdr_display_name || c.sdr_agents.name}
                </Badge>
              )}
              {c.email_accounts?.email_address && (
                <Badge variant="outline" className="text-[10px]">
                  via {c.email_accounts.email_address}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={c.intent ?? ""} onValueChange={onChangeIntent}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Set intent" />
              </SelectTrigger>
              <SelectContent>
                {INTENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={onArchive}>
              <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground">Loading…</div>
        ) : thread.messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground">No messages yet.</div>
        ) : (
          thread.messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>

      <div className="border-t bg-background p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Reply as {c.sdr_agents?.sdr_display_name || c.sdr_agents?.name || "you"}
          </span>
          <Button variant="ghost" size="sm" onClick={onGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Drafting…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate AI draft
              </>
            )}
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a reply…"
          className="min-h-[100px] text-sm"
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onSend} disabled={!draft.trim()}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Approve &amp; send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const outbound = m.direction === "outbound";
  const time = m.sent_at || m.received_at || m.created_at;
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <Card
        className={`max-w-[80%] p-3 ${
          outbound ? "bg-primary/10 ring-1 ring-primary/20" : "bg-background"
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium">{m.from_name || m.from_email}</span>
          {m.ai_generated && (
            <Badge variant="outline" className="h-4 gap-1 px-1 text-[9px]">
              <Sparkles className="h-2.5 w-2.5" /> AI
            </Badge>
          )}
          {m.status === "draft" && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] text-amber-600">
              Draft
            </Badge>
          )}
          {m.status === "queued" && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] text-sky-600">
              Queued
            </Badge>
          )}
          <span className="ml-auto">{new Date(time).toLocaleString()}</span>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">
          {m.body_text || (m.body_html ? <em>(HTML content)</em> : null)}
        </div>
      </Card>
    </div>
  );
}

function AnalyticsStrip({
  data,
}: {
  data: {
    total: number;
    meetings: number;
    unsubscribes: number;
    intent_counts: Record<string, number>;
    campaigns: { id: string; name: string; count: number }[];
  } | null;
}) {
  if (!data) {
    return <div className="mt-2 text-xs text-muted-foreground">Crunching numbers…</div>;
  }
  const interested = data.intent_counts["interested"] ?? 0;
  const objection = data.intent_counts["objection"] ?? 0;
  const notInterested = data.intent_counts["not_interested"] ?? 0;
  const cards = [
    { label: "Replies", value: data.total },
    { label: "Interested", value: interested, accent: "text-emerald-600" },
    { label: "Objections", value: objection, accent: "text-amber-600" },
    { label: "Not interested", value: notInterested, accent: "text-rose-600" },
    { label: "Meetings booked", value: data.meetings, accent: "text-violet-600" },
    { label: "Unsubscribes", value: data.unsubscribes ?? 0, accent: "text-zinc-500" },
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className="px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
          <div className={`text-lg font-semibold ${c.accent ?? ""}`}>{c.value}</div>
        </Card>
      ))}
      {data.campaigns.length > 0 && (
        <Card className="col-span-2 px-3 py-2 sm:col-span-6">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Top campaigns by replies
          </div>
          <div className="flex flex-wrap gap-2">
            {data.campaigns.map((c) => (
              <Badge key={c.id} variant="secondary" className="gap-1 text-xs">
                {c.name}
                <span className="text-muted-foreground">· {c.count}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function EmptyList({ noAccounts, onTryDemo }: { noAccounts: boolean; onTryDemo: () => void }) {
  return (
    <div className="p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
        <Mail className="h-6 w-6 text-primary" />
      </div>
      <p className="text-sm font-medium">
        {noAccounts ? "No inboxes connected yet" : "Nothing here"}
      </p>
      <p className="mx-auto mt-2 max-w-xs text-xs text-muted-foreground">
        {noAccounts
          ? "Head to Sending accounts → Email to add an inbox. Replies will start flowing here automatically."
          : "Try clearing some filters."}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onTryDemo}>
        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Load sample data
      </Button>
    </div>
  );
}

// ============== Demo data ==============

const DEMO_CONVOS: Conversation[] = [
  {
    id: "demo-1",
    lead_email: "sarah.chen@brightlabs.io",
    lead_name: "Sarah Chen",
    company: "BrightLabs",
    subject: "Re: Quick idea for BrightLabs' outbound",
    last_message_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    last_direction: "inbound",
    unread_count: 1,
    intent: "interested",
    status: "open",
    list_id: null,
    email_account_id: null,
    agent_id: null,
    lists: { name: "Q2 SaaS founders" },
    email_accounts: { email_address: "alex@nexusai.co" },
    sdr_agents: { name: "Alex (SDR)", sdr_display_name: "Alex" },
  },
  {
    id: "demo-2",
    lead_email: "marcus@northwind-ai.com",
    lead_name: "Marcus Lee",
    company: "Northwind AI",
    subject: "Re: 15 min next week?",
    last_message_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    last_direction: "outbound",
    unread_count: 0,
    intent: "objection",
    status: "open",
    list_id: null,
    email_account_id: null,
    agent_id: null,
    lists: { name: "AI tooling founders" },
    email_accounts: { email_address: "alex@nexusai.co" },
    sdr_agents: { name: "Alex (SDR)", sdr_display_name: "Alex" },
  },
  {
    id: "demo-3",
    lead_email: "p.garcia@helixhealth.com",
    lead_name: "Priya Garcia",
    company: "Helix Health",
    subject: "Re: Cutting your SDR ramp time in half",
    last_message_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    last_direction: "inbound",
    unread_count: 1,
    intent: "meeting_booked",
    status: "open",
    list_id: null,
    email_account_id: null,
    agent_id: null,
    lists: { name: "Healthtech ops" },
    email_accounts: { email_address: "alex@nexusai.co" },
    sdr_agents: { name: "Alex (SDR)", sdr_display_name: "Alex" },
  },
  {
    id: "demo-4",
    lead_email: "noreply@boldcfo.com",
    lead_name: "Jamie Boldwin",
    company: "BoldCFO",
    subject: "Re: A faster path to pipeline",
    last_message_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    last_direction: "inbound",
    unread_count: 0,
    intent: "not_interested",
    status: "open",
    list_id: null,
    email_account_id: null,
    agent_id: null,
    lists: { name: "Q2 SaaS founders" },
    email_accounts: { email_address: "sam@nexusai.co" },
    sdr_agents: { name: "Sam (SDR)", sdr_display_name: "Sam" },
  },
];

const DEMO_MESSAGES: Record<string, Message[]> = {
  "demo-1": [
    {
      id: "m1",
      direction: "outbound",
      from_email: "alex@nexusai.co",
      from_name: "Alex",
      subject: "Quick idea for BrightLabs' outbound",
      body_text:
        "Hey Sarah — saw BrightLabs is hiring 3 SDRs this quarter. We help teams replace 60% of that ramp time with an AI rep that books meetings on day 1. Worth a 15-min look?",
      body_html: null,
      sent_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      received_at: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      ai_generated: true,
      status: "sent",
    },
    {
      id: "m2",
      direction: "inbound",
      from_email: "sarah.chen@brightlabs.io",
      from_name: "Sarah Chen",
      subject: "Re: Quick idea for BrightLabs' outbound",
      body_text:
        "Interesting — how does it work with our existing HubSpot sequences? And what does pricing look like for ~3 reps?",
      body_html: null,
      sent_at: null,
      received_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      ai_generated: false,
      status: "received",
    },
  ],
  "demo-2": [
    {
      id: "m3",
      direction: "outbound",
      from_email: "alex@nexusai.co",
      from_name: "Alex",
      subject: "15 min next week?",
      body_text: "Marcus — saw you posted about scaling Northwind's GTM. Free for 15 min Thursday?",
      body_html: null,
      sent_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      received_at: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      ai_generated: true,
      status: "sent",
    },
    {
      id: "m4",
      direction: "inbound",
      from_email: "marcus@northwind-ai.com",
      from_name: "Marcus Lee",
      subject: "Re: 15 min next week?",
      body_text:
        "We just signed with Outreach 60 days ago. Hard to look at anything new right now, sorry.",
      body_html: null,
      sent_at: null,
      received_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      ai_generated: false,
      status: "received",
    },
    {
      id: "m5",
      direction: "outbound",
      from_email: "alex@nexusai.co",
      from_name: "Alex",
      subject: "Re: 15 min next week?",
      body_text:
        "Totally get it — we layer on top of Outreach rather than replace it. Happy to circle back in Q3 if helpful?",
      body_html: null,
      sent_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      received_at: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      ai_generated: true,
      status: "sent",
    },
  ],
  "demo-3": [
    {
      id: "m6",
      direction: "outbound",
      from_email: "alex@nexusai.co",
      from_name: "Alex",
      subject: "Cutting your SDR ramp time in half",
      body_text: "Priya — short version: AI SDR that books meetings while your team sleeps.",
      body_html: null,
      sent_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
      received_at: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
      ai_generated: true,
      status: "sent",
    },
    {
      id: "m7",
      direction: "inbound",
      from_email: "p.garcia@helixhealth.com",
      from_name: "Priya Garcia",
      subject: "Re: Cutting your SDR ramp time in half",
      body_text: "Booked you on my calendar for Wed at 2pm PT. Looking forward.",
      body_html: null,
      sent_at: null,
      received_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      ai_generated: false,
      status: "received",
    },
  ],
  "demo-4": [
    {
      id: "m8",
      direction: "outbound",
      from_email: "sam@nexusai.co",
      from_name: "Sam",
      subject: "A faster path to pipeline",
      body_text: "Jamie — quick one: AI SDRs that 4x your meeting volume. Worth a look?",
      body_html: null,
      sent_at: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
      received_at: null,
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
      ai_generated: true,
      status: "sent",
    },
    {
      id: "m9",
      direction: "inbound",
      from_email: "noreply@boldcfo.com",
      from_name: "Jamie Boldwin",
      subject: "Re: A faster path to pipeline",
      body_text: "Not a fit, please remove from your list.",
      body_html: null,
      sent_at: null,
      received_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      ai_generated: false,
      status: "received",
    },
  ],
};

const DEMO_ANALYTICS = {
  total: 47,
  meetings: 6,
  unsubscribes: 3,
  intent_counts: {
    interested: 14,
    objection: 9,
    not_interested: 11,
    meeting_booked: 6,
    question: 4,
    ooo: 2,
    unsubscribe: 1,
  },
  campaigns: [
    { id: "c1", name: "Q2 SaaS founders", count: 22 },
    { id: "c2", name: "AI tooling founders", count: 14 },
    { id: "c3", name: "Healthtech ops", count: 11 },
  ],
};
