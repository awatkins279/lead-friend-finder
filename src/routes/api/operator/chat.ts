import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider, getLovableAiGatewayRunId, withLovableAiGatewayRunIdHeader } from "@/lib/ai-gateway.server";

const requestSchema = z.object({ threadId: z.string().uuid(), messages: z.array(z.any()).min(1).max(200) });

const SYSTEM = `You are NexusAi Operator, an expert B2B demand-generation strategist and sales-operations leader. Your only business objective is to maximize qualified booked meetings while protecting deliverability, compliance, budget, brand trust, and user control.

Operate like a disciplined professional, not a generic assistant. Start from minimal information, inspect live portfolio data, research credible current sources when useful, and ask only for missing constraints that materially change execution. Caller count, daily calling hours, geography, offer, exclusions, meeting definition, and sending capacity matter. State reasonable assumptions instead of creating unnecessary friction.

Before any campaign mutation, produce a comprehensive campaign blueprint with distinct non-overlapping plays, ICP filters, scoring, validation rules, email/call sequences, daily volumes, timing, mailbox/caller capacity, CTA, reply handling, experiments, success metrics, stop-loss rules, risks, dependencies, costs, and citations. Use create_campaign_blueprint only when it is complete enough to execute. Audience guardrails may contain up to 100,000 leads; do not default or silently cap campaigns at 1,000 leads. If the user's profile enables full autonomy, the saved blueprint is automatically authorized and built; otherwise it waits for explicit approval. Never claim an action happened unless a tool result confirms it.

Use markdown. Be concise but thorough where decisions matter. Never fabricate research, intent, performance, or attribution. Prefer the customer's measured campaign data over generic internet advice once enough data exists.`;

async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !key) return null;
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims?.sub;
  return error || typeof userId !== "string" ? null : { db: db as any, userId };
}

export const Route = createFileRoute("/api/operator/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) return new Response("Invalid chat request", { status: 400 });
        const { threadId, messages } = parsed.data as { threadId: string; messages: UIMessage[] };
        const { data: thread } = await auth.db.from("operator_threads").select("id,title").eq("id", threadId).eq("user_id", auth.userId).maybeSingle();
        if (!thread) return new Response("Conversation not found", { status: 404 });

        const latest = messages[messages.length - 1];
        if (latest?.role === "user") {
          const { error } = await auth.db.from("operator_messages").upsert({ thread_id: threadId, user_id: auth.userId, ai_message_id: latest.id, role: "user", message: latest }, { onConflict: "thread_id,ai_message_id", ignoreDuplicates: true });
          if (error) return new Response("Could not save your message", { status: 500 });
          if (thread.title === "New campaign plan") {
            const text = latest.parts?.filter((part: any) => part.type === "text").map((part: any) => part.text).join(" ").trim();
            if (text) await auth.db.from("operator_threads").update({ title: text.slice(0, 72) }).eq("id", threadId).eq("user_id", auth.userId);
          }
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("AI service is not configured", { status: 500 });
        const gateway = createLovableAiGatewayProvider(apiKey, getLovableAiGatewayRunId(request));
        const result = streamText({
          model: gateway("google/gemini-3.1-pro-preview"),
          system: SYSTEM,
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(50),
          tools: {
            inspect_portfolio: tool({
              description: "Inspect the user's live campaign, lead, sending, calling, and meeting readiness before designing a strategy.",
              inputSchema: z.object({ reason: z.string().max(300) }),
              execute: async () => {
                const [campaigns, leads, mailboxes, phones, meetings, profile] = await Promise.all([
                  auth.db.from("lists").select("id,name,campaign_status,what_selling,sending_days,sending_start_time,sending_end_time,sending_timezone,created_at").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(30),
                  auth.db.from("leads").select("id", { count: "exact", head: true }),
                  auth.db.from("email_accounts").select("id,email_address,provider,status,daily_limit").eq("user_id", auth.userId),
                  auth.db.from("user_phone_accounts").select("id,provider,status,phone_number").eq("user_id", auth.userId),
                  auth.db.from("meetings").select("id,status,start_at,created_at").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(30),
                  auth.db.from("profiles").select("company_name,product_name,product_description,product_value_props,ideal_customer,proof_points,common_objections,call_to_action").eq("id", auth.userId).maybeSingle(),
                ]);
                return { campaigns: campaigns.data ?? [], leadDatabaseCount: leads.count ?? 0, sendingAccounts: mailboxes.data ?? [], phoneAccounts: phones.data ?? [], recentMeetings: meetings.data ?? [], productInfo: profile.data ?? null };
              },
            }),
            research_market: tool({
              description: "Search current web sources for market, audience, competitor, outreach timing, deliverability, or compliance evidence. Use citations in the blueprint.",
              inputSchema: z.object({ query: z.string().min(3).max(500), limit: z.number().int().min(2).max(8).default(5) }),
              execute: async ({ query, limit }) => {
                const firecrawlKey = process.env.FIRECRAWL_API_KEY;
                if (!firecrawlKey) return { error: "Web research is unavailable; clearly label unsupported assumptions." };
                const response = await fetch("https://api.firecrawl.dev/v2/search", { method: "POST", headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }) });
                const payload = await response.json();
                if (!response.ok) return { error: `Research failed (${response.status})` };
                const results = payload.data?.web ?? payload.web ?? payload.data ?? [];
                return { results: Array.isArray(results) ? results.slice(0, limit).map((item: any) => ({ title: item.title, url: item.url, description: item.description, content: String(item.markdown ?? "").slice(0, 6000) })) : [] };
              },
            }),
            estimate_audience: tool({
              description: "Estimate database audience size for one campaign play using job titles, industries, company sizes, locations, and contact requirements.",
              inputSchema: z.object({ titles: z.array(z.string()).max(20).default([]), industries: z.array(z.string()).max(15).default([]), locations: z.array(z.string()).max(15).default([]), hasEmail: z.boolean().default(true), hasPhone: z.boolean().default(false) }),
              execute: async ({ titles, industries, locations, hasEmail, hasPhone }) => {
                let query = auth.db.from("leads").select("id", { count: "exact", head: true });
                if (titles.length) query = query.or(titles.map((value: string) => `title.ilike.%${value.replace(/[,%]/g, "")}%`).join(","));
                if (industries.length) query = query.or(industries.map((value: string) => `org_industry.ilike.%${value.replace(/[,%]/g, "")}%`).join(","));
                if (locations.length) query = query.or(locations.map((value: string) => `country.ilike.%${value.replace(/[,%]/g, "")}%`).join(","));
                if (hasEmail) query = query.not("email", "is", null);
                if (hasPhone) query = query.not("phone", "is", null);
                const { count, error } = await query;
                return error ? { error: error.message } : { estimatedMatches: count ?? 0, filters: { titles, industries, locations, hasEmail, hasPhone } };
              },
            }),
            create_campaign_blueprint: tool({
              description: "Save the complete campaign strategy. For users who enabled full autonomy, immediately authorize and build it within its guardrails; otherwise wait for approval.",
              inputSchema: z.object({
                offerBrief: z.string().min(3).max(10000),
                strategy: z.object({
                  executiveSummary: z.string(), assumptions: z.array(z.string()), plays: z.array(z.object({ name: z.string(), hypothesis: z.string(), audience: z.string(), filters: z.record(z.string(), z.any()), estimatedAudience: z.number(), messagingAngle: z.string(), channels: z.array(z.string()), emailPlan: z.string(), callingPlan: z.string(), successMetric: z.string() })).min(1).max(6),
                  schedule: z.object({ dailyEmails: z.number(), sendWindows: z.string(), followUpCadence: z.string(), callerCount: z.number(), dailyCallsPerCaller: z.number() }),
                  validationPolicy: z.string(), meetingPath: z.string(), experiments: z.array(z.string()), dependencies: z.array(z.string()), risks: z.array(z.string()), citations: z.array(z.object({ title: z.string(), url: z.string().url(), takeaway: z.string() })), estimatedCredits: z.number(), reviewCadence: z.string(), stopLossRules: z.array(z.string())
                }),
                guardrails: z.object({ maxDailyEmails: z.number(), maxDailyCalls: z.number(), maxLeads: z.number().int().min(1).max(100000), allowedChannels: z.array(z.string()), requiresNewApproval: z.array(z.string()) })
              }),
              execute: async ({ offerBrief, strategy, guardrails }) => {
                const { data: current } = await auth.db.from("operator_blueprints").select("version").eq("thread_id", threadId).eq("user_id", auth.userId).order("version", { ascending: false }).limit(1);
                const version = Number(current?.[0]?.version ?? 0) + 1;
                await auth.db.from("operator_blueprints").update({ status: "superseded" }).eq("thread_id", threadId).eq("user_id", auth.userId).eq("status", "draft");
                const { data: blueprint, error } = await auth.db.from("operator_blueprints").insert({ thread_id: threadId, user_id: auth.userId, version, offer_brief: offerBrief, strategy, guardrails, status: "draft" }).select("id,thread_id,version,status,offer_brief,strategy,guardrails").single();
                if (error || !blueprint) return { error: error?.message ?? "Could not save plan" };
                const { data: preferences } = await auth.db.from("profiles").select("operator_autonomy_enabled").eq("id", auth.userId).maybeSingle();
                if (preferences?.operator_autonomy_enabled) {
                  await auth.db.from("operator_events").insert({ thread_id: threadId, blueprint_id: blueprint.id, user_id: auth.userId, event_type: "blueprint_created", status: "completed", title: `Campaign plan v${version} created under full autonomy`, details: { plays: strategy.plays.length, estimated_credits: strategy.estimatedCredits } });
                  const { buildApprovedBlueprint } = await import("@/lib/operator-build.server");
                  const build = await buildApprovedBlueprint({ db: auth.db, userId: auth.userId, blueprint });
                  return { blueprintId: blueprint.id, version, status: build.status, campaigns: build.createdCampaigns, message: "Full autonomy is enabled. The plan was authorized and campaign preparation started automatically." };
                }
                await auth.db.from("operator_events").insert({ thread_id: threadId, blueprint_id: blueprint.id, user_id: auth.userId, event_type: "blueprint_created", status: "approval_required", title: `Campaign plan v${version} ready for approval`, details: { plays: strategy.plays.length, estimated_credits: strategy.estimatedCredits } });
                return { blueprintId: blueprint.id, version, status: "approval_required", message: "The plan is saved. No campaign actions have run. Ask the user to review the plan card and select Approve & build." };
              },
            }),
          },
        });

        const response = result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: completed }) => {
            const assistant = [...completed].reverse().find((message) => message.role === "assistant");
            if (!assistant) return;
            const { error } = await auth.db.from("operator_messages").upsert({ thread_id: threadId, user_id: auth.userId, ai_message_id: assistant.id, role: "assistant", message: assistant }, { onConflict: "thread_id,ai_message_id" });
            if (error) console.error("Operator message persistence failed", error.message);
            await auth.db.from("operator_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", auth.userId);
          },
        });
        return withLovableAiGatewayRunIdHeader(response, gateway);
      },
    },
  },
});