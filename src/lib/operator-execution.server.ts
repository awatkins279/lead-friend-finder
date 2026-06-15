const SCORE_BATCH_SIZE = 250;
const VERIFY_BATCH_SIZE = 250;
const GENERATE_BATCH_SIZE = 250;

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
  outreach_template?: { emails: any[]; callScript: any };
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
  const maxLeads = Math.min(Math.max(input.maxLeads, 1), 100_000);
  const titles = cleanFilters(play.filters?.titles);
  const industries = cleanFilters(play.filters?.industries);
  const locations = cleanFilters(play.filters?.locations);
  const leadIds: string[] = [];
  for (let offset = 0; leadIds.length < maxLeads; offset += 1000) {
    let query = db.from("leads").select("id");
    if (titles.length) query = query.or(titles.map((value) => `title.ilike.%${value}%`).join(","));
    if (industries.length) query = query.or(industries.map((value) => `org_industry.ilike.%${value}%`).join(","));
    if (locations.length) query = query.or(locations.map((value) => `country.ilike.%${value}%`).join(","));
    query = query.not("email", "is", null).range(offset, offset + Math.min(999, maxLeads - leadIds.length - 1));
    const { data: leads, error: leadError } = await query;
    if (leadError) throw new Error(leadError.message);
    const page = (leads ?? []).map((lead: { id: string }) => String(lead.id));
    leadIds.push(...page);
    if (page.length < 1000) break;
  }
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
    .insert({ user_id: userId, context, total_batches: batches.length, total_leads: leadIds.length, status: "running", scoring_mode: "hybrid_fast", rubric: buildFastRubric(context) })
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
  const results = await Promise.all((events ?? []).map(async (event: any) => {
    try {
      return await advancePipeline(db, event);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Operator execution failed";
      await db.from("operator_events").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", event.id);
      return { id: event.id, error: message };
    }
  }));
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
  let qualifiedCount = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data: rows, error: resultError } = await db.from("scoring_results")
      .select("lead_id,score,reasoning,signals,strengths,gaps")
      .eq("job_id", details.scoring_job_id).gt("score", details.score_threshold).range(offset, offset + 999);
    if (resultError) throw new Error(resultError.message);
    if (!rows?.length) break;
    const { error: insertError } = await db.from("list_leads").upsert(rows.map((row: any) => ({
      list_id: details.campaign_id, lead_id: row.lead_id, score: row.score,
      research: { reasoning: row.reasoning, ipp_breakdown: row.signals, strengths: row.strengths, gaps: row.gaps }, status: "new",
    })), { onConflict: "list_id,lead_id" });
    if (insertError) throw new Error(insertError.message);
    qualifiedCount += rows.length;
    if (rows.length < 1000) break;
  }
  const next: PipelineDetails = { ...details, stage: "validating", validation_cursor: 0, progress_current: 0, progress_total: qualifiedCount, live_text: "Checking qualified email addresses for deliverability" };
  await updateEvent(db, event.id, `Validating ${qualifiedCount.toLocaleString()} qualified email addresses`, next);
  return { id: event.id, stage: "validating", qualified: qualifiedCount };
}

async function advanceValidation(db: any, event: any, details: PipelineDetails) {
  const cursor = details.validation_cursor ?? 0;
  const { data: pending, error: pendingError } = await db.from("list_leads").select("lead_id,score,research")
    .eq("list_id", details.campaign_id).is("verification_status", null).limit(VERIFY_BATCH_SIZE);
  if (pendingError) throw new Error(pendingError.message);
  const slice = (pending ?? []).map((row: any) => ({ id: row.lead_id, score: row.score, research: row.research }));
  if (slice.length) {
    const ids = slice.map((row: { id: string }) => row.id);
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
    await Promise.all(verified.map((row: { id: string; status: string }) => db.from("list_leads").update({ verification_status: row.status }).eq("list_id", details.campaign_id).eq("lead_id", row.id)));
    const total = details.progress_total ?? 0;
    const next = { ...details, validation_cursor: cursor + slice.length, progress_current: cursor + slice.length, progress_total: total, live_text: `Verifying email batch ${cursor + 1}-${Math.min(cursor + slice.length, total)}` };
    await updateEvent(db, event.id, `Validating emails · ${Math.min(cursor + slice.length, total)}/${total}`, next);
    return { id: event.id, stage: "validating", processed: slice.length };
  }
  const { count: deliverableCount } = await db.from("list_leads").select("lead_id", { count: "exact", head: true }).eq("list_id", details.campaign_id).eq("verification_status", "deliverable");
  const next: PipelineDetails = { ...details, stage: "generating", generation_cursor: 0, generated: 0, phone_ready: 0, progress_current: 0, progress_total: deliverableCount ?? 0, live_text: "Writing personalized email sequences and call plans" };
  await updateEvent(db, event.id, `Generating personalized outreach for ${(deliverableCount ?? 0).toLocaleString()} validated contacts`, next);
  return { id: event.id, stage: "generating", deliverable: deliverableCount ?? 0 };
}

async function advanceGeneration(db: any, event: any, details: PipelineDetails) {
  const cursor = details.generation_cursor ?? 0;
  const { data: pending } = await db.from("list_leads").select("lead_id").eq("list_id", details.campaign_id).eq("verification_status", "deliverable").neq("status", "enriched").limit(GENERATE_BATCH_SIZE);
  const slice = pending ?? [];
  if (slice.length) {
    const [{ data: campaign }, { data: leads }] = await Promise.all([
      db.from("lists").select("name,what_selling,key_selling_points,extra_instructions,num_emails,sender_name,sender_company").eq("id", details.campaign_id).single(),
      db.from("leads").select("id,first_name,last_name,title,email,phone,org_name,org_industry,org_description,org_employee_count").in("id", slice.map((row: any) => row.lead_id)),
    ]);
    const template = details.outreach_template ?? await generateOutreach(campaign, {});
    const generated = (leads ?? []).map((lead: any) => personalizeTemplate(template, lead));
    const updates = await Promise.all(generated.map((item: any) => db.from("list_leads").update({ emails: item.emails, email_subject: item.emails[0]?.subject ?? "", email_body: item.emails[0]?.body ?? "", call_script: item.callScript, status: "enriched" }).eq("list_id", details.campaign_id).eq("lead_id", item.leadId)));
    const failedUpdate = updates.find((result: any) => result.error);
    if (failedUpdate?.error) throw new Error(failedUpdate.error.message);
    const total = details.progress_total ?? 0;
    const next = { ...details, outreach_template: template, generation_cursor: cursor + slice.length, generated: (details.generated ?? 0) + generated.length, phone_ready: (details.phone_ready ?? 0) + (leads ?? []).filter((lead: any) => Boolean(lead.phone)).length, progress_current: cursor + slice.length, progress_total: total, live_text: `Personalizing outreach for contacts ${cursor + 1}-${Math.min(cursor + slice.length, total)}` };
    await updateEvent(db, event.id, `Building emails and call plans · ${Math.min(cursor + slice.length, total)}/${total}`, next);
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
        { role: "system", content: "Create a concise reusable B2B outreach template. Use {{first_name}}, {{company}}, and {{title}} placeholders where relevant. Return valid JSON only. Never invent contact details." },
        { role: "user", content: `Campaign: ${campaign.what_selling}\nAngle: ${campaign.key_selling_points ?? ""}\nInstructions: ${campaign.extra_instructions ?? ""}\nSender: ${campaign.sender_name ?? "Sales team"} at ${campaign.sender_company ?? "our company"}\nProspect: ${lead.first_name ?? ""} ${lead.last_name ?? ""}, ${lead.title ?? ""} at ${lead.org_name ?? ""}; ${lead.org_industry ?? ""}; ${lead.org_description ?? ""}.\nReturn {"emails":[{"subject":"","body":"","cta":"","send_after_days":0} exactly ${count} items],"callScript":{"opener":"","talk_track":[{"heading":"","body":""}],"problem_questions":[],"solution_questions":[],"consequence_questions":[],"qualifying_questions":[],"close":"","objection_map":[]}}.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Outreach generation failed (${response.status})`);
  const payload = await response.json();
  const parsed = JSON.parse(String(payload.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim());
  return { leadId: lead.id, emails: Array.isArray(parsed.emails) ? parsed.emails.slice(0, count) : [], callScript: parsed.callScript ?? null };
}

function personalizeTemplate(template: { emails: any[]; callScript: any }, lead: any) {
  const replacements: Array<[RegExp, string]> = [
    [/\{\{first_name\}\}/gi, String(lead.first_name ?? "there")],
    [/\{\{company\}\}/gi, String(lead.org_name ?? "your company")],
    [/\{\{title\}\}/gi, String(lead.title ?? "your role")],
  ];
  const replace = (value: unknown) => replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ""));
  const emails = (template.emails ?? []).map((email: any) => ({ ...email, subject: replace(email.subject), body: replace(email.body), cta: replace(email.cta) }));
  return { leadId: lead.id, emails, callScript: template.callScript };
}

async function updateEvent(db: any, id: string, title: string, details: PipelineDetails) {
  const { error } = await db.from("operator_events").update({ title, details }).eq("id", id);
  if (error) throw new Error(error.message);
}

function cleanFilters(values?: string[]) {
  return (values ?? []).map((value) => String(value).replace(/[,%]/g, "").trim()).filter(Boolean).slice(0, 20);
}

function buildFastRubric(context: string) {
  const normalized = context.toLowerCase();
  const words = normalized.match(/[a-z][a-z0-9+.-]{2,}/g) ?? [];
  const ignored = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "sell", "selling", "want", "need", "company", "companies", "business", "leads"]);
  const catalog = ["owner", "founder", "ceo", "president", "chief", "vp", "vice president", "director", "head", "manager"];
  const industries = ["software", "saas", "healthcare", "financial", "insurance", "construction", "manufacturing", "real estate", "marketing", "technology", "retail", "logistics"];
  return { titles: catalog.filter((value) => normalized.includes(value)), industries: industries.filter((value) => normalized.includes(value)), keywords: Array.from(new Set(words.filter((word) => !ignored.has(word)))).slice(0, 24), exclusions: ["student", "intern", "assistant"] };
}