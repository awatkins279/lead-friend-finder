import { useEffect, useMemo, useRef } from "react";
import { Brain, Mic, MicOff, Loader2, Sparkles, AlertCircle, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveCoaching } from "@/hooks/useLiveCoaching";
import type { CallScript } from "@/lib/calls.functions";

type Coaching = ReturnType<typeof useLiveCoaching>;

type Props = {
  listId: string;
  leadId: string;
  callId?: string | null;
  enabled: boolean;
  script: CallScript;
  getRemoteStream?: () => MediaStream | null;
  /** Returns the heading of the script section the rep is currently on (best-effort match). */
  onCurrentSectionChange?: (heading: string | null) => void;
  /** Externally-owned coaching state. When provided, this panel does not spin up its own mic. */
  coaching?: Coaching;
};

/** AI co-pilot panel — shows live transcript, the AI's next-line suggestion, and an auto-followed script position. */
export function LiveCopilotPanel({
  listId,
  leadId,
  callId,
  enabled,
  script,
  getRemoteStream,
  onCurrentSectionChange,
  coaching: sharedCoaching,
}: Props) {
  const localCoaching = useLiveCoaching({
    listId,
    leadId,
    callId: callId ?? null,
    enabled: enabled && !sharedCoaching,
    getRemoteStream,
  });
  const { listening, error, turns, suggestion, suggesting, start, stop, requestSuggestion } =
    sharedCoaching ?? localCoaching;


  // auto-start when call is in progress
  const startedRef = useRef(false);
  useEffect(() => {
    if (enabled && callId && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    if (!callId) {
      startedRef.current = false;
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, callId]);

  // Flatten script into searchable sections for auto-highlight.
  const sections = useMemo(() => {
    const out: { key: string; heading: string; body: string }[] = [];
    out.push({ key: "opener", heading: "Opener", body: script.opener });
    script.talk_track?.forEach((s, i) => out.push({ key: `tt-${i}`, heading: s.heading, body: s.body }));
    script.problem_questions?.forEach((q, i) =>
      out.push({ key: `pq-${i}`, heading: "Problem question", body: q }),
    );
    script.solution_questions?.forEach((q, i) =>
      out.push({ key: `sq-${i}`, heading: "Solution question", body: q }),
    );
    script.consequence_questions?.forEach((q, i) =>
      out.push({ key: `cq-${i}`, heading: "Consequence question", body: q }),
    );
    script.qualifying_questions?.forEach((q, i) =>
      out.push({ key: `qq-${i}`, heading: "Qualifying question", body: q }),
    );
    out.push({ key: "close", heading: "Close", body: script.close });
    return out;
  }, [script]);

  // Match the rep's last ~3 utterances to the closest script section by word-overlap.
  const currentSectionKey = useMemo(() => {
    const recentRep = turns
      .filter((t) => t.role === "rep" && t.final)
      .slice(-3)
      .map((t) => t.text)
      .join(" ")
      .toLowerCase();
    if (recentRep.length < 8) return null;
    const tokens = new Set(recentRep.split(/\W+/).filter((w) => w.length > 3));
    let best = { key: null as string | null, score: 0 };
    for (const s of sections) {
      const body = s.body.toLowerCase();
      let score = 0;
      tokens.forEach((t) => {
        if (body.includes(t)) score++;
      });
      if (score > best.score) best = { key: s.key, score };
    }
    return best.score >= 2 ? best.key : null;
  }, [turns, sections]);

  useEffect(() => {
    if (!onCurrentSectionChange) return;
    const s = sections.find((x) => x.key === currentSectionKey);
    onCurrentSectionChange(s?.heading ?? null);
  }, [currentSectionKey, sections, onCurrentSectionChange]);

  // auto-scroll transcript
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <Brain className="h-8 w-8 opacity-60" />
        <p className="font-medium text-foreground">AI co-pilot is off</p>
        <p className="text-xs">Enable it in this campaign's calling config.</p>
      </div>
    );
  }

  const intentColor = (i: string) =>
    i === "objection"
      ? "from-[oklch(0.66_0.22_18)] to-[oklch(0.72_0.20_30)]"
      : i === "close"
        ? "from-[oklch(0.70_0.18_150)] to-[oklch(0.75_0.16_170)]"
        : i === "discovery"
          ? "from-[oklch(0.62_0.18_265)] to-[oklch(0.68_0.16_245)]"
          : i === "rapport"
            ? "from-[oklch(0.72_0.18_320)] to-[oklch(0.78_0.16_340)]"
            : "from-[oklch(0.60_0.10_260)] to-[oklch(0.66_0.10_245)]";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-5 pb-3">
        <div className="rounded-xl bg-gradient-to-r from-[oklch(0.50_0.22_295)] to-[oklch(0.62_0.20_265)] px-4 py-2 shadow-[0_0_24px_-6px_oklch(0.60_0.22_290/0.9)]">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.25em] text-white">
            <Sparkles className="h-3 w-3" /> Live co-pilot
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {listening ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
              <Radio className="h-3 w-3 animate-pulse" /> listening
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
              <MicOff className="h-3 w-3" /> idle
            </span>
          )}
          {!listening ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={start}>
              <Mic className="mr-1 h-3.5 w-3.5" /> Start
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Suggestion card */}
      <div className="px-4 pb-3">
        {suggestion ? (
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${intentColor(suggestion.intent)}`} />
            <div className="mb-2 flex items-center justify-between">
              <span className={`rounded-full bg-gradient-to-r ${intentColor(suggestion.intent)} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white`}>
                {suggestion.intent}
              </span>
              {suggesting && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            {suggestion.prospect_quote && (
              <p className="mb-2 border-l-2 border-white/20 pl-2 text-[11px] italic text-muted-foreground">
                "{suggestion.prospect_quote}"
              </p>
            )}
            <p className="text-base font-medium leading-relaxed text-white">{suggestion.suggestion}</p>
            {suggestion.why && (
              <p className="mt-2 text-[11px] text-muted-foreground">{suggestion.why}</p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs text-muted-foreground">
            {suggesting ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Thinking…</span>
            ) : (
              "Suggestions appear here when the prospect speaks."
            )}
          </div>
        )}
      </div>

      {/* Live transcript */}
      <div className="mx-4 mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Live transcript</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => requestSuggestion()}>
          <Sparkles className="mr-1 h-3 w-3" /> Ask now
        </Button>
      </div>
      <div ref={scrollRef} className="mx-4 mb-4 flex-1 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
        {turns.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">Waiting for audio…</p>
        ) : (
          turns.map((t) => (
            <div key={t.id} className="flex gap-2">
              <span
                className={`mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[9px] font-bold uppercase tracking-wider ${
                  t.role === "rep"
                    ? "bg-[oklch(0.55_0.22_290/0.25)] text-[oklch(0.90_0.10_290)]"
                    : "bg-[oklch(0.62_0.18_200/0.25)] text-[oklch(0.90_0.10_200)]"
                }`}
              >
                {t.role}
              </span>
              <span className={t.final ? "text-foreground" : "text-muted-foreground italic"}>{t.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
