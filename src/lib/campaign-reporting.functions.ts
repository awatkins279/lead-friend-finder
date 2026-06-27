import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Campaign Reporting ============

const campaignInput = z.object({ listId: z.string().uuid() });

export type CampaignReport = {
  totalLeads: number;
  enriched: number;
  scripted: number;
  active: number;
  emailsSent: number;
  emailsOpened: number;
  emailsClicked: number;
  repliesReceived: number;
  interestedReplies: number;
  meetingsBooked: number;
  unsubscribes: number;
  bounces: number;
  callsAttempted: number;
  callsCompleted: number;
  callsScored: number;
  avgCallScore: number | null;
  topPerformers: Array<{ email: string; replies: number }>;
  dailyActivity: Array<{ date: string; emails: number; replies: number; calls: number }>;
};

export const getCampaignReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => campaignInput.parse(i))
  .handler(async ({ data, context }): Promise<CampaignReport> => {
    const { supabase, userId } = context;

    // Verify ownership
    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("id", data.listId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!list) throw new Error("Campaign not found");

    // Lead statuses
    const [{ data: statuses }, { count: totalLeads }, { data: conversations }, { data: calls }] =
      await Promise.all([
        supabase.from("list_leads").select("status, score").eq("list_id", data.listId),
        supabase
          .from("list_leads")
          .select("*", { count: "exact", head: true })
          .eq("list_id", data.listId),
        supabase
          .from("sdr_conversations")
          .select("id, intent, status, last_message_at, email_accounts(email_address)")
          .eq("list_id", data.listId),
        supabase
          .from("calls")
          .select("id, status, call_score, duration_sec")
          .eq("list_id", data.listId),
      ]);

    const rows = statuses || [];
    const enriched = rows.filter(
      (r: any) => r.status === "enriched" || r.status === "scripted" || r.status === "active",
    ).length;
    const scripted = rows.filter((r: any) => r.status === "scripted").length;
    const active = rows.filter((r: any) => r.status === "active").length;

    // Email stats (approximate from list_leads)
    const emailsSent = rows.filter(
      (r: any) => r.status === "active" || r.status === "scripted",
    ).length;

    // Placeholder for email engagement metrics (would need Instantly webhook data)
    const emailsOpened = 0;
    const emailsClicked = 0;

    // Conversation stats
    const convos = conversations || [];
    const repliesReceived = convos.length;
    const interestedReplies = convos.filter(
      (c: any) => c.intent === "interested" || c.intent === "meeting_booked",
    ).length;
    const meetingsBooked = convos.filter((c: any) => c.intent === "meeting_booked").length;
    const unsubscribes = convos.filter((c: any) => c.intent === "unsubscribe").length;
    const bounces = convos.filter(
      (c: any) => c.intent === "other" && c.status === "archived",
    ).length;

    // Top performers (by email account)
    const byEmail: Record<string, number> = {};
    for (const c of convos) {
      const email = (c as any).email_accounts?.email_address || "unknown";
      byEmail[email] = (byEmail[email] || 0) + 1;
    }
    const topPerformers = Object.entries(byEmail)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([email, replies]) => ({ email, replies }));

    // Call stats
    const callRows = calls || [];
    const callsAttempted = callRows.length;
    const callsCompleted = callRows.filter((c: any) => c.status === "completed").length;
    const callsScored = callRows.filter((c: any) => c.call_score != null).length;
    const scoredCalls = callRows.filter((c: any) => c.call_score != null);
    const avgCallScore =
      scoredCalls.length > 0
        ? Math.round(
            scoredCalls.reduce((sum: number, c: any) => sum + (c.call_score || 0), 0) /
              scoredCalls.length,
          )
        : null;

    // Daily activity (last 30 days)
    const dailyActivity: Array<{ date: string; emails: number; replies: number; calls: number }> =
      [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayConvos = convos.filter((c: any) => {
        const dt = (c as any).last_message_at;
        return dt && dt.startsWith(dateStr);
      });
      const dayCalls = callRows.filter((c: any) => {
        const dt = (c as any).created_at || (c as any).ended_at;
        return dt && dt.startsWith(dateStr);
      });
      dailyActivity.push({
        date: dateStr,
        emails: Math.round(emailsSent / 30), // approximate
        replies: dayConvos.length,
        calls: dayCalls.length,
      });
    }

    return {
      totalLeads: totalLeads || 0,
      enriched,
      scripted,
      active,
      emailsSent,
      emailsOpened,
      emailsClicked,
      repliesReceived,
      interestedReplies,
      meetingsBooked,
      unsubscribes,
      bounces,
      callsAttempted,
      callsCompleted,
      callsScored,
      avgCallScore,
      topPerformers,
      dailyActivity,
    };
  });
