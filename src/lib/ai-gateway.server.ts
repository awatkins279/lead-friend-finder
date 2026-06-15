import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export function createLovableAiGatewayProvider(apiKey: string, initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let resolved = false;
  const ready = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });
  const publish = (value?: string) => {
    const next = value?.trim() || undefined;
    if (!runId && next) runId = next;
    if (!resolved) {
      resolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publish(runId);

  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(RUN_ID_HEADER)) headers.set(RUN_ID_HEADER, runId);
      try {
        const response = await fetch(input, { ...init, headers });
        publish(response.headers.get(RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publish(undefined);
        throw error;
      }
    },
  });
  return Object.assign(provider, {
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : ready),
  });
}

export function getLovableAiGatewayRunId(request: Request) {
  return request.headers.get(RUN_ID_HEADER)?.trim() || undefined;
}

export async function withLovableAiGatewayRunIdHeader(
  response: Response,
  gateway: { getRunId: () => string | undefined; waitForRunId: () => Promise<string | undefined> },
) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const firstChunk = reader.read();
  const runId = await gateway.waitForRunId();
  const headers = new Headers(response.headers);
  if (runId) headers.set(RUN_ID_HEADER, runId);
  headers.set("Access-Control-Expose-Headers", RUN_ID_HEADER);
  const body = new ReadableStream({
    async start(controller) {
      try {
        const first = await firstChunk;
        if (!first.done) controller.enqueue(first.value);
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          controller.enqueue(chunk.value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}