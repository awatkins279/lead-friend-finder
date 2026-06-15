const SCORE_BATCH_SIZE = 15;
const VERIFY_BATCH_SIZE = 25;
const GENERATE_BATCH_SIZE = 4;

type Play = {
  name?: string;
  audience?: string;
  filters?: { titles?: string[]; industries?: string[]; locations?: string[] };
  emailPlan?: string;
  callingPlan?: string;
  messagingAngle?: string;
};

type PipelineDetails = {
  campaign_id: string;
  scoring_job_id: string;
  stage: "scoring" | "validating" | "generating";
  score_threshold: number;
  target_count: number;
  qualified?: Array<{ id: string; score: number; research: Record<string, unknown> }>;
  validation_cursor?: number;
  deliverable?: Array<{ id: string; score: number; research: Record<string, unknown> }>;
  generation_cursor?: number;
  generated?: number;
  phone_ready?: number;
  progress_current?: number;
  progress_total?: number;
  live_text?: string;
};

export async function startOperatorPipeline(input: {
  db: any;
  userId: string;
  threadId: string;
  blueprintId: string;
  campaignId: string;
  offerBrief: string;
  play: Play;
  maxLeads: number;
  scoreThreshold?: number;
}) {
  const { db, userId, threadId, blueprintId, campaignId, offerBrief, play } = input;
  const maxLeads = Math.min(Math.max(input.maxLeads, 1), 20_000);
  let query = db.from("leads").select("id").limit(maxLeads);
  const titles = cleanFilters(play.filters?.titles);
  const industries = cleanFilters(play.filters?.industries);
  const locations = cleanFilters(play.filters?.locations);
  if (titles.length) query = query.or(titles.map((value) => `title.ilike.%${value}%`).join(","));
  if (industries.length)
    query = query.or(industries.map((value) => `org_industry.ilike.%${value}%`).join(","));
  if (locations.length)
    query = query.or(locations.map((value) => `country.ilike.%${value}%`).join(","));
  query = query.not("email", "is", null);
  const { data: leads, error: leadError } = await query;
  if (leadError) throw new Error(leadError.message);
  const leadIds: string[] = Array.from(
    new Set<string>((leads ?? []).map((lead: { id: string }) => String(lead.id))),
  );
  if (!leadIds.length) {
    await db.from("operator_events").insert({
      thread_id: threadId,
      blueprint_id: blueprintId,
      user_id: userId,
      event_type: "operator_pipeline",
      status: "failed",
      title: `No matching contacts found for ${play.name ?? "campaign"}`,
      error: "The approved audience filters returned no contacts with email addresses.",
      details: { campaign_id: campaignId },
    });
    return null;
  }

  const context = [offerBrief, play.audience, play.messagingAngle].filter(Boolean).join("\n\n").slice(0, 4000);
  const batches: string[][] = [];
  for (let index = 0; index < leadIds.length; index += SCORE_BATCH_SIZE)
    batches.push(leadIds.slice(index, index + SCORE_BATCH_SIZE));
  const { data: job, error: jobError } = await db
    .from("scoring_jobs")
    .insert({ user_id: userId, context, total_batches: batches.length, total_leads: leadIds.length, status: "running" })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(jobError?.message ?? "Could not start lead scoring");
  for (let index = 0; index < batches.length; index += 500) {
    const { error } = await db.from("scoring_job_batches").insert(
      batches.slice(index, index + 500).map((batch) => ({ job_id: job.id, lead_ids: batch, status: "pending" })),
    );
    if (error) throw new Error(error.message);
  }
  const details: PipelineDetails = {
    campaign_id: campaignId,
    scoring_job_id: job.id,
    stage: "scoring",
    score_threshold: input.scoreThreshold ?? 60,
    target_count: leadIds.length,
    progress_current: 0,
    progress_total: leadIds.length,
    live_text: `Loading the first ${Math.min(SCORE_BATCH_SIZE, leadIds.length)} contacts for ICP scoring`,
  };
  const { error: eventError } = await db.from("operator_events").insert({
    thread_id: threadId,
    blueprint_id: blueprintId,
    user_id: userId,
    event_type: "operator_pipeline",
    status: "running",
    title: `Scoring ${leadIds.length.toLocaleString()} matched contacts`,
    details,
  });
  if (eventError) throw new Error(eventError.message);
  await db.from("operator_blueprints").update({ status: "running" }).eq("id", blueprintId).eq("user_id", userId);
  return { jobId: job.id, leadCount: leadIds.length };
}

export async function processOperatorPipelines(db: any, limit = 4) {
  const { data: events, error } = await db
    .from("operator_events")
    .select("id,thread_id,blueprint_id,user_id,title,details")
    .eq("event_type", "operator_pipeline")
    .eq("status", "running")
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(error.message);
  const results = [];
  for (const event of events ?? []) {
    try {
      results.push(await advancePipeline(db, event));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Operator execution failed";
      await db.from("operator_events").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", event.id);
      results.push({ id: event.id, error: message });
    }
  }
  return results;
}

async function advancePipeline(db: any, event: any) {
  const details = event.details as PipelineDetails;
  if (details.stage === "scoring") return advanceScoring(db, event, details);
  if (details.stage === "validating") return advanceValidation(db, event, details);
  return advanceGeneration(db, event, details);
}

async function advanceScoring(db: any, event: any, details: PipelineDetails) {
  const { data: job, error } = await db
    .from("scoring_jobs")
    .select("status,total_leads,scored_leads,completed_batches,failed_batches,total_batches")
    .eq("id", details.scoring_job_id)
    .single();
  if (error || !job) throw new Error(error?.message ?? "Scoring job disappeared");
  if (job.status === "running") {
    const next = {
      ...details,
      progress_current: job.scored_leads,
      progress_total: job.total_leads,
      live_text: `Comparing contact ${Math.min(job.scored_leads + 1, job.total_leads)}-${Math.min(job.scored_leads + SCORE_BATCH_SIZE, job.total_leads)} against the campaign ICP`,
    };
    await updateEvent(db, event.id, `Scoring contacts · ${job.scored_leads}/${job.total_leads}`, next);
    return { id: event.id, stage: "scoring" };
  }
  const { data: batches, error: batchError } = await db
    .from("scoring_job_batches")
    .select("results")
    .eq("job_id", details.scoring_job_id)
    .eq("status", "done");
  if (batchError) throw new Error(batchError.message);
  const qualified = (batches ?? [])
    .flatMap((batch: any) => (Array.isArray(batch.results) ? batch.results : []))
    .filter((row: any) => Number(row.score) > details.score_threshold)
    .map((row: any) => ({
      id: String(row.leadId),
      score: Number(row.score),
      research: { reasoning: row.reasoning ?? "", ipp_breakdown: row.signals ?? [], strengths: row.strengths ?? [], gaps: row.gaps ?? [] },
    }));
  const next: PipelineDetails = { ...details, stage: "validating", qualified, validation_cursor: 0, deliverable: [], progress_current: 0, progress_total: qualified.length, live_text: "Checking qualified email addresses for deliverability" };
  await updateEvent(db, event.id, `Validating ${qualified.length.toLocaleString()} qualified email addresses`, next);
  return { id: event.id, stage: "validating", qualified: qualified.length };
}

async function advanceValidation(db: any, event: any, details: PipelineDetails) {
  const qualified = details.qualified ?? [];
  const cursor = details.validation_cursor ?? 0;
  const slice = qualified.slice(cursor, cursor + VERIFY_BATCH_SIZE);
  if (slice.length) {
    const ids = slice.map((row) => row.id);
    const { data: leads, error } = await db.from("leads").select("id,email").in("id", ids);
    if (error) throw new Error(error.message);
    const apiKey = process.env.MILLIONVERIFIER_API_KEY;
    if (!apiKey) throw new Error("Email validation is not configured");
    const verified = await Promise.all(
      (leads ?? []).map(async (lead: { id: string; email: string | null }) => {
        if (!lead.email) return { id: lead.id, email: null, status: "invalid", result: "no_email", quality: "bad" };
        try {
          const response = await fetch(`https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(lead.email)}&timeout=10`);
          if (!response.ok) throw new Error(`Validation HTTP ${response.status}`);
          const payload = await response.json();
          const result = String(payload?.result ?? "error");
          return { id: lead.id, email: lead.email, status: result === "ok" ? "deliverable" : result === "catch_all" ? "risky" : result === "disposable" ? "disposable" : "invalid", result, quality: String(payload?.quality ?? "bad") };
        } catch {
          return { id: lead.id, email: lead.email, status: "unknown", result: "error", quality: "bad" };
        }
      }),
    );
    await db.from("lead_verifications").upsert(
      verified.map((row) => ({ user_id: event.user_id, lead_id: row.id, status: row.status, result: row.result, quality: row.quality, email: row.email, verified_at: new Date().toISOString() })),
    );
    const byId = new Map(slice.map((row) => [row.id, row]));
    const deliverable = [
      ...(details.deliverable ?? []),
      ...verified.filter((row) => row.status === "deliverable").map((row) => byId.get(row.id)).filter(Boolean),
    ] as PipelineDetails["deliverable"];
    const next = { ...details, validation_cursor: cursor + slice.length, deliverable, progress_current: cursor + slice.length, progress_total: qualified.length, live_text: `Verifying email batch ${cursor + 1}-${Math.min(cursor + slice.length, qualified.length)}` };
    await updateEvent(db, event.id, `Validating emails · ${Math.min(cursor + slice.length, qualified.length)}/${qualified.length}`, next);
    return { id: event.id, stage: "validating", processed: slice.length };
  }
  const deliverable = details.deliverable ?? [];
  for (let index = 0; index < deliverable.length; index += 500) {
    const { error } = await db.from("list_leads").upsert(
      deliverable.slice(index, index + 500).map((row) => ({ list_id: details.campaign_id, lead_id: row.id, score: row.score, research: row.research, verification_status: "deliverable", status: "new" })),
      { onConflict: "list_id,lead_id" },
    );
    if (error) throw new Error(error.message);
  }
  const next: PipelineDetails = { ...details, qualified: undefined, stage: "generating", generation_cursor: 0, generated: 0, phone_ready: 0, progress_current: 0, progress_total: deliverable.length, live_text: "Writing personalized email sequences and call plans" };
  await updateEvent(db, event.id, `Generating personalized outreach for ${deliverable.length.toLocaleString()} validated contacts`, next);
  return { id: event.id, stage: "generating", deliverable: deliverable.length };
}

async function advanceGeneration(db: any, event: any, details: PipelineDetails) {
  const deliverable = details.deliverable ?? [];
  const cursor = details.generation_cursor ?? 0;
  const slice = deliverable.slice(cursor, cursor + GENERATE_BATCH_SIZE);
  if (slice.length) {
    const [{ data: campaign }, { data: leads }] = await Promise.all([
      db.from("lists").select("name,what_selling,key_selling_points,extra_instructions,num_emails,sender_name,sender_company").eq("id", details.campaign_id).single(),
      db.from("leads").select("id,first_name,last_name,title,email,phone,org_name,org_industry,org_description,org_employee_count").in("id", slice.map((row) => row.id)),
    ]);
    const generated = await Promise.all((leads ?? []).map((lead: any) => generateOutreach(campaign, lead)));
    for (const item of generated) {
      const { error } = await db.from("list_leads").update({ emails: item.emails, email_subject: item.emails[0]?.subject ?? "", email_body: item.emails[0]?.body ?? "", call_script: item.callScript, status: "enriched" }).eq("list_id", details.campaign_id).eq("lead_id", item.leadId);
      if (error) throw new Error(error.message);
    }
    const next = { ...details, generation_cursor: cursor + slice.length, generated: (details.generated ?? 0) + generated.length, phone_ready: (details.phone_ready ?? 0) + (leads ?? []).filter((lead: any) => Boolean(lead.phone)).length, progress_current: cursor + slice.length, progress_total: deliverable.length, live_text: `Personalizing outreach for contacts ${cursor + 1}-${Math.min(cursor + slice.length, deliverable.length)}` };
    await updateEvent(db, event.id, `Building emails and call plans · ${Math.min(cursor + slice.length, deliverable.length)}/${deliverable.length}`, next);
    return { id: event.id, stage: "generating", processed: slice.length };
  }
  await db.from("operator_events").update({ status: "completed", title: `Campaign ready · ${details.generated ?? 0} contacts prepared`, details }).eq("id", event.id);
  await db.from("operator_blueprints").update({ status: "completed" }).eq("id", event.blueprint_id);
  return { id: event.id, stage: "completed" };
}

async function generateOutreach(campaign: any, lead: any) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI generation is not configured");
  const count = Math.max(1, Math.min(Number(campaign.num_emails ?? 4), 6));
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Create concise, personalized B2B outreach. Return valid JSON only. Never invent contact details." },
        { role: "user", content: `Campaign: ${campaign.what_selling}\nAngle: ${campaign.key_selling_points ?? ""}\nInstructions: ${campaign.extra_instructions ?? ""}\nSender: ${campaign.sender_name ?? "Sales team"} at ${campaign.sender_company ?? "our company"}\nProspect: ${lead.first_name ?? ""} ${lead.last_name ?? ""}, ${lead.title ?? ""} at ${lead.org_name ?? ""}; ${lead.org_industry ?? ""}; ${lead.org_description ?? ""}.\nReturn {"emails":[{"subject":"","body":"","cta":"","send_after_days":0} exactly ${count} items],"callScript":{"opener":"","talk_track":[{"heading":"","body":""}],"problem_questions":[],"solution_questions":[],"consequence_questions":[],"qualifying_questions":[],"close":"","objection_map":[]}}.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Outreach generation failed (${response.status})`);
  const payload = await response.json();
  const parsed = JSON.parse(String(payload.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim());
  return { leadId: lead.id, emails: Array.isArray(parsed.emails) ? parsed.emails.slice(0, count) : [], callScript: parsed.callScript ?? null };
}

async function updateEvent(db: any, id: string, title: string, details: PipelineDetails) {
  const { error } = await db.from("operator_events").update({ title, details }).eq("id", id);
  if (error) throw new Error(error.message);
}

function cleanFilters(values?: string[]) {
  return (values ?? []).map((value) => String(value).replace(/[,%]/g, "").trim()).filter(Boolean).slice(0, 20);
}