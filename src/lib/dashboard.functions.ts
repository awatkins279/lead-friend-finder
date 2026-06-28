import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardStats = {
  totalLeads: number;
  activeCampaigns: number;
  emailsSent: number;
  callsMade: number;
  interestedReplies: number;
  meetingsBooked: number;
  creditsRemaining: number;
  conversationsOpen: number;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase, userId } = context;

    const [
      { count: totalLeads },
      { count: activeCampaigns },
      { data: conversations },
      { data: credits },
    ] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("imported_by", userId),
      supabase
        .from("lists")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("campaign_status", "active"),
      supabase
        .from("sdr_conversations")
        .select("id, intent, status")
        .eq("user_id", userId)
        .neq("status", "archived"),
      supabase.rpc("get_credit_summary", { _user_id: userId }),
    ]);

    const convos = conversations || [];
    const interestedReplies = convos.filter(
      (c: any) => c.intent === "interested" || c.intent === "meeting_booked",
    ).length;
    const meetingsBooked = convos.filter((c: any) => c.intent === "meeting_booked").length;
    const conversationsOpen = convos.filter((c: any) => c.status !== "closed").length;

    // Count emails sent (list_leads has no user_id — scope by the user's lists)
    const { data: userLists } = await supabase
      .from("lists")
      .select("id")
      .eq("user_id", userId);
    const listIds = (userLists ?? []).map((l: { id: string }) => l.id);
    let emailsSent = 0;
    if (listIds.length > 0) {
      const { count } = await supabase
        .from("list_leads")
        .select("*", { count: "exact", head: true })
        .in("list_id", listIds)
        .not("emails", "is", null);
      emailsSent = count ?? 0;
    }

    const { count: callsMade } = await supabase
      .from("calls")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const creditRow = Array.isArray(credits) && credits.length ? (credits[0] as any) : null;

    return {
      totalLeads: totalLeads || 0,
      activeCampaigns: activeCampaigns || 0,
      emailsSent: emailsSent || 0,
      callsMade: callsMade || 0,
      interestedReplies,
      meetingsBooked,
      creditsRemaining: creditRow?.remaining || 0,
      conversationsOpen,
    };
  });
