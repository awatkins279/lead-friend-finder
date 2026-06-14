// Lightweight AI classifier for inbound prospect replies. Maps a reply to one of
// the inbox's intent tags so conversations sort themselves. Server-side only
// (uses the AI gateway key). Best-effort: returns null on any failure so it can
// never block inbound ingestion.

export const INBOX_INTENTS = [
  "interested",
  "meeting_booked",
  "question",
  "objection",
  "not_interested",
  "unsubscribe",
  "ooo",
  "other",
] as const;

export type InboxIntent = (typeof INBOX_INTENTS)[number];

const SYSTEM = `You classify a prospect's email reply to a cold outreach into EXACTLY ONE intent.
Respond ONLY with JSON: {"intent":"<one of the values>","confidence":0-100}. No prose.

Intents:
- interested: positive — wants to learn more, hear details, or engage
- meeting_booked: agrees to / confirms a meeting or call, or proposes a specific time
- question: asks a question without being clearly positive or negative
- objection: pushback (price, timing, "we already have a tool") but not a flat no
- not_interested: clear no, not a fit, or "stop"
- unsubscribe: explicitly asks to be removed / unsubscribed / to stop emailing
- ooo: automated out-of-office or auto-responder
- other: bounce, wrong person, gibberish, or anything else`;

export async function classifyIntent(opts: {
  text: string;
  subject?: string | null;
  apiKey: string;
}): Promise<{ intent: InboxIntent; confidence: number } | null> {
  const body = (opts.text ?? "").slice(0, 4000).trim();
  if (!body || !opts.apiKey) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `${opts.subject ? `Subject: ${opts.subject}\n\n` : ""}${body}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 60,
      }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const content: string = payload.choices?.[0]?.message?.content ?? "{}";
    let parsed: { intent?: string; confidence?: number };
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    const intent = String(parsed.intent ?? "").toLowerCase();
    if (!(INBOX_INTENTS as readonly string[]).includes(intent)) return null;
    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = 60;
    confidence = Math.max(0, Math.min(100, Math.round(confidence)));
    return { intent: intent as InboxIntent, confidence };
  } catch {
    return null;
  }
}
