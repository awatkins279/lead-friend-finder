import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { practiceColdCall, type CallScorecard } from "@/lib/call-practice.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Phone,
  Send,
  RotateCcw,
  Sparkles,
  Star,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

const SCENARIOS = [
  { value: "skeptical", label: "Skeptical VP", desc: "Tough but fair — asks hard questions" },
  { value: "friendly", label: "Friendly Director", desc: "Open but needs ROI proof" },
  { value: "gatekeeper", label: "Gatekeeper", desc: "Screening calls, protective" },
  { value: "angry", label: "Stressed Manager", desc: "Having a bad day — stay calm" },
];

type Message = { role: "rep" | "prospect"; text: string };

export function ColdCallPractice() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [scenario, setScenario] = useState("skeptical");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scorecard, setScorecard] = useState<CallScorecard | null>(null);
  const [started, setStarted] = useState(false);
  const [coachingTip, setCoachingTip] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const submitMessage = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setLoading(true);

    // Optimistic add rep message
    const repMsg: Message = { role: "rep", text };
    setMessages((prev) => [...prev, repMsg]);

    try {
      const result = await practiceColdCall({
        data: {
          sessionId: sessionId || undefined,
          scenario: scenario as "skeptical" | "friendly" | "gatekeeper" | "angry",
          message: text,
        },
      });

      if (result.sessionId !== sessionId) setSessionId(result.sessionId);

      // Add prospect reply
      setMessages((prev) => [...prev, { role: "prospect", text: result.prospectReply }]);

      if (result.coachingTip) setCoachingTip(result.coachingTip);
      if (result.isEnding && result.scorecard) {
        setScorecard(result.scorecard);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "prospect", text: "Sorry, the practice bot encountered an error. Try again." },
      ]);
    }
    setLoading(false);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const reset = () => {
    setMessages([]);
    setSessionId(null);
    setScorecard(null);
    setCoachingTip(null);
    setStarted(false);
  };

  if (!started) {
    return (
      <Card className="mx-auto max-w-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <Brain className="h-12 w-12 mx-auto text-purple-400" />
          <h2 className="text-xl font-bold">AI Cold Call Practice</h2>
          <p className="text-muted-foreground text-sm">
            Practice your cold calls with an AI prospect. Pick a scenario, type what you'd say, and
            get real-time feedback.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Prospect Type</label>
            <Select value={scenario} onValueChange={setScenario}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <div>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{s.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:opacity-90"
            size="lg"
            onClick={() => {
              setStarted(true);
              setMessages([
                {
                  role: "prospect",
                  text:
                    scenario === "angry"
                      ? "*answers phone abruptly* Yeah, who's this?"
                      : scenario === "gatekeeper"
                        ? "Good morning, [Company Name], this is Pat. How can I help you?"
                        : "Hello, this is [Name]. How can I help you today?",
                },
              ]);
            }}
          >
            <Phone className="mr-2 h-4 w-4" /> Start Practice Call
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Scenario badge + reset */}
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="gap-1">
          <Brain className="h-3 w-3" />
          {SCENARIOS.find((s) => s.value === scenario)?.label}
        </Badge>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="mr-1 h-3 w-3" /> New
        </Button>
      </div>

      {/* Coaching tip */}
      {coachingTip && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <Sparkles className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <span className="text-amber-200">{coachingTip}</span>
        </div>
      )}

      {/* Chat area */}
      <Card className="p-4 space-y-3 max-h-[50vh] overflow-y-auto" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "rep" ? "justify-end" : ""}`}>
            {msg.role === "prospect" && (
              <div className="h-8 w-8 rounded-full bg-blue-600/30 flex items-center justify-center shrink-0">
                <Brain className="h-4 w-4 text-blue-400" />
              </div>
            )}
            <div
              className={`rounded-2xl px-4 py-2.5 max-w-[80%] text-sm ${
                msg.role === "rep"
                  ? "bg-gradient-to-r from-purple-600/40 to-blue-600/40 text-white"
                  : "bg-white/10 text-foreground"
              }`}
            >
              {msg.text}
            </div>
            {msg.role === "rep" && (
              <div className="h-8 w-8 rounded-full bg-purple-600/30 flex items-center justify-center shrink-0">
                <Phone className="h-4 w-4 text-purple-400" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-blue-600/30 flex items-center justify-center shrink-0">
              <Brain className="h-4 w-4 text-blue-400 animate-pulse" />
            </div>
            <div className="rounded-2xl px-4 py-2.5 bg-white/10">
              <span className="text-sm text-muted-foreground animate-pulse">Typing...</span>
            </div>
          </div>
        )}
      </Card>

      {/* Input area */}
      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitMessage();
            }
          }}
          placeholder={
            scorecard
              ? "Practice complete! Start a new session."
              : "What would you say to the prospect?"
          }
          className="min-h-[60px] resize-none"
          disabled={!!scorecard || loading}
        />
        <Button
          size="icon"
          className="h-[60px] w-[60px] shrink-0 bg-gradient-to-r from-purple-600 to-blue-600"
          onClick={submitMessage}
          disabled={!input.trim() || loading || !!scorecard}
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>

      {/* Scorecard */}
      {scorecard && (
        <Card className="p-6 space-y-4 border-2 border-purple-500/50">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-400" /> Call Scorecard
            </h3>
            <div className="text-3xl font-bold text-purple-400">{scorecard.overall_score}/100</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ScoreBadge label="Opener" score={scorecard.opener_rating} />
            <ScoreBadge label="Discovery" score={scorecard.discovery_rating} />
            <ScoreBadge label="Objections" score={scorecard.objection_handling} />
            <ScoreBadge label="Closing" score={scorecard.closing_rating} />
          </div>
          <p className="text-sm text-muted-foreground">
            Talk/Listen: {scorecard.talk_listen_ratio}
          </p>
          <div>
            <h4 className="text-sm font-semibold text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> Strengths
            </h4>
            <ul className="text-sm text-muted-foreground ml-4 mt-1 space-y-1">
              {scorecard.strengths.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Improve
            </h4>
            <ul className="text-sm text-muted-foreground ml-4 mt-1 space-y-1">
              {scorecard.improvements.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>
          <p className="text-sm italic text-muted-foreground border-t border-white/10 pt-3">
            {scorecard.summary}
          </p>
          <Button onClick={reset} className="w-full" variant="outline">
            <RotateCcw className="mr-2 h-4 w-4" /> Practice Again
          </Button>
        </Card>
      )}
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const color = score >= 8 ? "text-green-400" : score >= 6 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="flex justify-between items-center rounded-lg bg-white/5 px-3 py-2">
      <span className="text-xs font-medium">{label}</span>
      <span className={`text-sm font-bold ${color}`}>{score}/10</span>
    </div>
  );
}
