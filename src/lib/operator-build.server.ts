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
  await db.from("operator_events").insert({
    thread_id: blueprint.thread_id,
    blueprint_id: blueprint.id,
    user_id: userId,
    event_type: "blueprint_approved",
    status: "completed",
    title: "Campaign plan approved",
    details: { approved_at: approvedAt, next: "Campaign build is authorized within the approved guardrails." },
  });

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
  return { ok: true, status: "running" as const, createdCampaigns };
}