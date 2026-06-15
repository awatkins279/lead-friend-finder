export async function buildApprovedBlueprint(input: {
  db: any;
  userId: string;
  blueprint: any;
}) {
  const { db, userId, blueprint } = input;
  const approvedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("operator_blueprints")
    .update({ status: "approved", approved_at: approvedAt })
    .eq("id", blueprint.id)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);
  const { error: queueError } = await db.from("operator_events").insert({
    thread_id: blueprint.thread_id,
    blueprint_id: blueprint.id,
    user_id: userId,
    event_type: "operator_build",
    status: "running",
    title: "Campaign plan approved · preparing campaigns",
    details: { approved_at: approvedAt, next: "Campaign preparation is queued and will continue in the background." },
  });
  if (queueError) throw new Error(queueError.message);
  return { ok: true, status: "running" as const, createdCampaigns: [] };
}

export async function processOperatorBuilds(db: any, limit = 2) {
  const { data: events, error } = await db.from("operator_events")
    .select("id,thread_id,blueprint_id,user_id")
    .eq("event_type", "operator_build").eq("status", "running")
    .order("created_at").limit(limit);
  if (error) throw new Error(error.message);
  return Promise.all((events ?? []).map(async (event: any) => {
    const { data: claimed, error: claimError } = await db.from("operator_events")
      .update({ status: "processing", title: "Creating campaigns and selecting matched contacts" })
      .eq("id", event.id).eq("status", "running").select("id").maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) return { id: event.id, skipped: true };
    try {
      const { data: blueprint, error: blueprintError } = await db.from("operator_blueprints")
        .select("id,thread_id,offer_brief,strategy,guardrails")
        .eq("id", event.blueprint_id).eq("user_id", event.user_id).single();
      if (blueprintError || !blueprint) throw new Error(blueprintError?.message ?? "Campaign plan not found");
      const createdCampaigns = await executeApprovedBlueprint({ db, userId: event.user_id, blueprint });
      await db.from("operator_events").update({
        status: "completed",
        title: `Campaign preparation started · ${createdCampaigns.length} campaign${createdCampaigns.length === 1 ? "" : "s"}`,
        details: { campaign_ids: createdCampaigns.map((campaign) => campaign.id) },
      }).eq("id", event.id);
      return { id: event.id, created: createdCampaigns.length };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Campaign preparation failed";
      await db.from("operator_events").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", event.id);
      await db.from("operator_blueprints").update({ status: "failed" }).eq("id", event.blueprint_id);
      return { id: event.id, error: message };
    }
  }));
}

async function executeApprovedBlueprint(input: { db: any; userId: string; blueprint: any }) {
  const { db, userId, blueprint } = input;

  const strategy = blueprint.strategy as {
    plays?: Array<{ name?: string; audience?: string; hypothesis?: string; messagingAngle?: string; emailPlan?: string; callingPlan?: string; estimatedAudience?: number; filters?: { titles?: string[]; industries?: string[]; locations?: string[] } }>;
  };
  const guardrails = blueprint.guardrails as { maxLeads?: number };
  const { data: profile } = await db.from("profiles").select("full_name,company_name").eq("id", userId).maybeSingle();
  const plays = Array.isArray(strategy?.plays) ? strategy.plays.slice(0, 6) : [];
  const createdCampaigns: Array<{ id: string; name: string }> = [];
  const { startOperatorPipeline } = await import("@/lib/operator-execution.server");

  let remainingLeads = Math.min(100_000, Math.max(1, Math.floor(Number(guardrails?.maxLeads ?? 100_000))));
  for (const play of plays) {
    if (remainingLeads <= 0) break;
    const name = String(play.name ?? "Operator campaign").trim().slice(0, 160);
    const description = [play.audience, play.hypothesis].filter(Boolean).join(" — ").slice(0, 2000) || null;
    const { data: campaign, error: campaignError } = await db.from("lists").insert({
      user_id: userId,
      name,
      description,
      what_selling: String(blueprint.offer_brief).slice(0, 4000),
      sender_name: String(profile?.full_name ?? "Sales team").slice(0, 160),
      sender_company: String(profile?.company_name ?? "").slice(0, 160) || null,
      key_selling_points: String(play.messagingAngle ?? "").slice(0, 4000) || null,
      extra_instructions: [play.emailPlan, play.callingPlan].filter(Boolean).join("\n\n").slice(0, 4000) || null,
      campaign_status: "draft",
    }).select("id,name").single();
    if (campaignError || !campaign) {
      await db.from("operator_events").insert({ thread_id: blueprint.thread_id, blueprint_id: blueprint.id, user_id: userId, event_type: "campaign_draft_failed", status: "failed", title: `Could not create ${name}`, error: campaignError?.message ?? "Unknown campaign error" });
      continue;
    }
    createdCampaigns.push(campaign);
    await db.from("operator_events").insert({ thread_id: blueprint.thread_id, blueprint_id: blueprint.id, user_id: userId, event_type: "campaign_draft_created", status: "completed", title: `Created draft campaign: ${campaign.name}`, details: { campaign_id: campaign.id, readiness: "Target leads, validate addresses, generate sequences, and connect sending accounts before launch." } });
    const playLeads = Math.min(remainingLeads, Math.max(1, Math.floor(Number(play.estimatedAudience ?? remainingLeads))));
    await startOperatorPipeline({
      db,
      userId,
      threadId: blueprint.thread_id,
      blueprintId: blueprint.id,
      campaignId: campaign.id,
      offerBrief: String(blueprint.offer_brief),
      play,
      maxLeads: playLeads,
      scoreThreshold: 60,
    });
    remainingLeads -= playLeads;
  }
  return createdCampaigns;
}