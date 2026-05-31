import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Radio, Sparkles, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CallScript } from "@/lib/calls.functions";
import type { useLiveCoaching } from "@/hooks/useLiveCoaching";

type Coaching = ReturnType<typeof useLiveCoaching>;

type Segment = {
  key: string;
  label: string;
  body: string;
  /** unique significant tokens used for match scoring */
  tokens: string[];
  highlight?: boolean;
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "to", "of", "in", "on", "at",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "should", "could", "can", "may",
  "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
  "it", "my", "your", "our", "their", "if", "then", "so", "with", "from",
  "by", "as", "about", "into", "out", "up", "down", "what", "when", "where",
  "why", "how", "okay", "ok", "yeah", "right", "just", "really", "very",
  "thats", "im", "youre", "ill", "ive", "dont", "doesnt", "isnt", "wasnt",
  "got", "get", "going", "gonna", "want", "like", "know", "think", "make",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function buildSegments(script: CallScript): Segment[] {
  const out: Segment[] = [];
  if (script.opener) out.push({ key: "opener", label: "Opener", body: script.opener, tokens: tokenize(script.opener), highlight: true });
  script.talk_track?.forEach((s, i) =>
    out.push({ key: `tt-${i}`, label: s.heading, body: s.body, tokens: tokenize(s.body) }),
  );
  script.problem_questions?.forEach((q, i) =>
    out.push({ key: `pq-${i}`, label: `Problem Q${i + 1}`, body: q, tokens: tokenize(q) }),
  );
  script.consequence_questions?.forEach((q, i) =>
    out.push({ key: `cq-${i}`, label: `Consequence Q${i + 1}`, body: q, tokens: tokenize(q) }),
  );
  script.solution_questions?.forEach((q, i) =>
    out.push({ key: `sq-${i}`, label: `Solution Q${i + 1}`, body: q, tokens: tokenize(q) }),
  );
  script.qualifying_questions?.forEach((q, i) =>
    out.push({ key: `qq-${i}`, label: `Qualifying Q${i + 1}`, body: q, tokens: tokenize(q) }),
  );
  if (script.close) out.push({ key: "close", label: "Close", body: script.close, tokens: tokenize(script.close), highlight: true });
  return out;
}

/**
 * Mic-driven teleprompter:
 * - Advances through the script automatically as the rep speaks, by matching their
 *   spoken words against each script segment's significant tokens.
 * - When the prospect speaks and the AI co-pilot returns a suggestion, the current
 *   segment is REPLACED in-place with a "Say this next" card showing the AI's
 *   real-time line. Press "Resume script" or just say it to continue.
 */
export function FollowAlongTeleprompter({
  script,
  coaching,
}: {
  script: CallScript;
  coaching: Coaching;
}) {
  const segments = useMemo(() => buildSegments(script), [script]);

  const { turns, suggestion, suggesting, listening, error, start, stop, requestSuggestion } = coaching;

  // Track which segments the rep has effectively "said" — needs ≥ 40% token overlap
  // OR ≥ 4 matched significant tokens.
  const completedSet = useMemo(() => {
    const repTextAll = turns
      .filter((t) => t.role === "rep" && t.final)
      .map((t) => t.text)
      .join(" ")
      .toLowerCase();
    if (repTextAll.length < 8) return new Set<string>();
    const repTokens = new Set(tokenize(repTextAll));
    const done = new Set<string>();
    for (const s of segments) {
      if (s.tokens.length === 0) continue;
      let hits = 0;
      for (const tk of s.tokens) if (repTokens.has(tk)) hits++;
      const ratio = hits / s.tokens.length;
      if (hits >= 4 || ratio >= 0.4) done.add(s.key);
    }
    return done;
  }, [turns, segments]);

  const [manualIdx, setManualIdx] = useState<number | null>(null);
  const autoIdx = useMemo(() => {
    const i = segments.findIndex((s) => !completedSet.has(s.key));
    return i === -1 ? segments.length - 1 : i;
  }, [segments, completedSet]);
  const currentIdx = manualIdx ?? autoIdx;
  const current = segments[currentIdx];

  // AI override window — when a fresh prospect turn triggered a suggestion,
  // surface it in place of the current script line for 25 seconds (or until rep speaks again).
  const lastProspectFinalAt = useMemo(() => {
    const t = [...turns].reverse().find((x) => x.role === "prospect" && x.final);
    return t?.ts ?? 0;
  }, [turns]);
  const lastRepFinalAt = useMemo(() => {
    const t = [...turns].reverse().find((x) => x.role === "rep" && x.final);
    return t?.ts ?? 0;
  }, [turns]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const overrideKey = suggestion ? `${suggestion.intent}::${suggestion.suggestion}` : "";
  const overrideActive =
    !!suggestion &&
    dismissedSuggestion !== overrideKey &&
    lastProspectFinalAt > 0 &&
    lastProspectFinalAt >= lastRepFinalAt &&
    now - lastProspectFinalAt < 25_000;

  // Auto-scroll: keep current segment near the top read-line
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  useEffect(() => {
    const key = current?.key;
    if (!key) return;
    const el = itemRefs.current.get(key);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const offset = el.offsetTop - scroller.clientHeight * 0.32;
    scroller.scrollTo({ top: offset, behavior: "smooth" });
  }, [current?.key]);

  const reset = () => {
    setManualIdx(0);
    setDismissedSuggestion(null);
    scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {/* Control bar */}
      <div className="relative flex shrink-0 items-center justify-between gap-4 px-5 pt-5 pb-3">
        <div className="rounded-xl bg-gradient-to-r from-[oklch(0.50_0.22_295)] to-[oklch(0.58_0.20_310)] px-4 py-2 shadow-[0_0_24px_-6px_oklch(0.55_0.22_290/0.9)]">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.25em] text-white">
            <Sparkles className="h-3 w-3" /> Live Script
          </span>
        </div>
        <div className="flex items-center gap-2">
          {listening ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
              <Radio className="h-3 w-3 animate-pulse" /> Following your voice
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground">
              <MicOff className="h-3 w-3" /> Mic idle
            </span>
          )}
          {!listening ? (
            <Button
              size="sm"
              onClick={() => start()}
              className="h-8 border-0 bg-gradient-to-r from-[oklch(0.70_0.18_290)] to-[oklch(0.78_0.16_210)] px-3 text-white shadow-[0_0_18px_-4px_oklch(0.70_0.18_290/0.9)] hover:opacity-95"
            >
              <Mic className="mr-1 h-3.5 w-3.5" /> Start mic
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stop()}
              className="h-8 border border-white/10 bg-white/[0.04] px-3 text-foreground hover:bg-white/[0.08]"
            >
              <MicOff className="mr-1 h-3.5 w-3.5" /> Pause mic
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={reset}
            className="h-8 w-8 border border-white/10 bg-white/[0.04] p-0 text-foreground hover:bg-white/[0.08]"
            title="Restart from top"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {/* Viewport */}
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[oklch(0.16_0.04_270)] via-[oklch(0.16_0.04_270/0.7)] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-[oklch(0.16_0.04_270)] via-[oklch(0.16_0.04_270/0.85)] to-transparent" />

        <div ref={scrollerRef} className="h-full overflow-y-auto px-8 py-12 [scrollbar-width:thin]">
          <div className="mx-auto max-w-3xl space-y-6">
            {segments.map((s, i) => {
              const isCurrent = i === currentIdx;
              const isDone = completedSet.has(s.key) && !isCurrent;
              const isUpcoming = !isDone && !isCurrent;

              return (
                <div
                  key={s.key}
                  ref={(el) => {
                    itemRefs.current.set(s.key, el);
                  }}
                  onClick={() => setManualIdx(i)}
                  className={`cursor-pointer transition-all duration-300 ${
                    isDone ? "opacity-30" : isUpcoming ? "opacity-50" : "opacity-100"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.3em]">
                    <span
                      className={`h-px w-8 bg-gradient-to-r ${
                        isCurrent ? "from-[oklch(0.78_0.16_210)]" : "from-[oklch(0.70_0.18_290)]"
                      } to-transparent`}
                    />
                    <span className={isCurrent ? "text-[oklch(0.88_0.10_210)]" : "text-muted-foreground"}>
                      {s.label}
                    </span>
                    {isCurrent && !overrideActive && (
                      <span className="rounded-full bg-[oklch(0.78_0.16_210/0.18)] px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] text-[oklch(0.88_0.10_210)]">
                        ← read here
                      </span>
                    )}
                    {isDone && (
                      <span className="font-mono text-[9px] tracking-[0.2em] text-emerald-400/70">✓ said</span>
                    )}
                  </div>

                  {isCurrent && overrideActive && suggestion ? (
                    <LiveCoachCard
                      suggestion={suggestion}
                      suggesting={suggesting}
                      onDismiss={() => setDismissedSuggestion(overrideKey)}
                      onRefresh={() => requestSuggestion()}
                      originalLine={s.body}
                    />
                  ) : (
                    <p
                      className={
                        isCurrent
                          ? "whitespace-pre-wrap rounded-2xl border border-[oklch(0.78_0.16_210/0.45)] bg-[oklch(0.78_0.16_210/0.08)] p-6 text-[1.6rem] font-medium leading-[1.55] tracking-tight text-white shadow-[0_0_40px_-12px_oklch(0.78_0.16_210/0.7)]"
                          : s.highlight
                            ? "whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.04] p-4 text-lg leading-relaxed"
                            : "whitespace-pre-wrap px-2 text-lg leading-relaxed"
                      }
                    >
                      {s.body}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="pt-6 text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
              — end of script —
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 px-5 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        {listening
          ? "speak naturally — script advances with your voice · click any line to jump"
          : "click start mic to enable voice-following teleprompter"}
      </div>
    </>
  );
}

function LiveCoachCard({
  suggestion,
  suggesting,
  onDismiss,
  onRefresh,
  originalLine,
}: {
  suggestion: NonNullable<Coaching["suggestion"]>;
  suggesting: boolean;
  onDismiss: () => void;
  onRefresh: () => void;
  originalLine: string;
}) {
  const intentColor =
    suggestion.intent === "objection"
      ? "from-[oklch(0.66_0.22_18)] to-[oklch(0.72_0.20_30)]"
      : suggestion.intent === "close"
        ? "from-[oklch(0.70_0.18_150)] to-[oklch(0.75_0.16_170)]"
        : suggestion.intent === "discovery"
          ? "from-[oklch(0.62_0.18_265)] to-[oklch(0.68_0.16_245)]"
          : suggestion.intent === "rapport"
            ? "from-[oklch(0.72_0.18_320)] to-[oklch(0.78_0.16_340)]"
            : "from-[oklch(0.55_0.22_290)] to-[oklch(0.62_0.20_265)]";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[oklch(0.78_0.16_210/0.55)] bg-gradient-to-br from-[oklch(0.20_0.05_290/0.6)] to-[oklch(0.16_0.04_270/0.6)] p-6 shadow-[0_0_60px_-12px_oklch(0.70_0.18_290/0.7)]">
      <span className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${intentColor}`} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r ${intentColor} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white`}>
          <Sparkles className="h-3 w-3" /> AI Coach · say this
        </span>
        <div className="flex items-center gap-1">
          {suggesting && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onRefresh}>
            <RotateCcw className="mr-1 h-3 w-3" /> Re-ask
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onDismiss}>
            Resume script
          </Button>
        </div>
      </div>

      {suggestion.prospect_quote && (
        <p className="mb-3 border-l-2 border-white/20 pl-3 text-[12px] italic text-muted-foreground">
          They said: "{suggestion.prospect_quote}"
        </p>
      )}

      <p className="whitespace-pre-wrap text-[1.55rem] font-medium leading-[1.55] tracking-tight text-white">
        {suggestion.suggestion}
      </p>

      {suggestion.why && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider text-[oklch(0.78_0.16_210)]">Why · </span>
          {suggestion.why}
        </p>
      )}

      <details className="mt-3 text-[11px] text-muted-foreground/70">
        <summary className="cursor-pointer select-none">Original scripted line</summary>
        <p className="mt-1 whitespace-pre-wrap pl-3">{originalLine}</p>
      </details>
    </div>
  );
}
