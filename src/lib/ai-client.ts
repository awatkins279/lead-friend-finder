// Centralized AI client — routes through Lovable AI Gateway.
// Server-side only. LOVABLE_API_KEY is auto-provisioned by Lovable.

const BASE_URL = "https://ai.gateway.lovable.dev/v1";
const API_KEY = process.env.LOVABLE_API_KEY || "";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  temperature?: number;
};

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  if (!API_KEY) {
    throw new Error("Missing LOVABLE_API_KEY — AI gateway is not configured");
  }

  const body: Record<string, unknown> = {
    model: opts.model || "google/gemini-2.5-flash",
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 4000,
  };

  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
  if (res.status === 402)
    throw new Error("AI credits exhausted — add credits in Settings → Plans & credits");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = await res.json();
  const content: string = payload.choices?.[0]?.message?.content ?? "";
  return content;
}

export function hasApiKey(): boolean {
  return !!API_KEY;
}
