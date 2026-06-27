// Centralized AI client — swap provider by changing OPENROUTER_API_KEY or OPENROUTER_BASE_URL
// All calls go through this module instead of ai.gateway.lovable.dev

const BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const API_KEY = process.env.OPENROUTER_API_KEY || "";

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
    throw new Error("Missing OPENROUTER_API_KEY — set it in .env");
  }

  const body: Record<string, unknown> = {
    model: opts.model || "deepseek/deepseek-chat",
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 4000,
  };

  if (opts.response_format) {
    body.response_format = opts.response_format;
  }
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) throw new Error("AI rate limit — try again in a moment");
  if (res.status === 402) throw new Error("AI credits exhausted — add credits to OpenRouter");
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
