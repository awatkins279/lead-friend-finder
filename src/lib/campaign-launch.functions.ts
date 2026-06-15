import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type SequenceEmail = {
  step?: number;
  subject?: string;
  body?: string;
  send_after_days?: number;
};

async function instantlyRequest(apiKey: string, path: string, init: RequestInit) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? `Instantly request failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return payload;
}

const inputSchema = z.object({ listId: z.string().uuid() });

export const launchCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: list, error: listError } = await db
      .from("lists")
      .select("id, name, user_id, campaign_status, instantly_campaign_id, unsubscribe_footer_enabled, unsubscribe_footer_text, sending_days, sending_start_time, sending_end_time, sending_timezone, follow_up_delay_days, email_gap_minutes")
      .eq("id", data.listId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (listError || !list) throw new Error("Campaign not found");

    if (list.instantly_campaign_id) {
      const { data: resumeRows, error: resumeError } = await db
        .from("list_leads")
        .select("verification_status, emails, lead:leads(email)")
        .eq("list_id", list.id);
      if (resumeError) throw new Error(resumeError.message);
      const blocked = (resumeRows ?? []).filter(
        (row: any) =>
          row.lead?.email &&
          Array.isArray(row.emails) &&
          row.emails.length > 0 &&
          !["deliverable", "risky"].includes(row.verification_status),
      );
      if (blocked.length > 0) {
        throw new Error(
          `${blocked.length} prospect${
            blocked.length === 1 ? " is" : "s are"
          } not approved for sending. Validate emails before resuming this campaign.`,
        );
      }
      await instantlyRequest(
        (await getConnection(db, context.userId)).api_key,
        `/campaigns/${list.instantly_campaign_id}/activate`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      await db.from("lists").update({ campaign_status: "active", launched_at: new Date().toISOString() }).eq("id", list.id);
      return { status: "active" as const, resumed: true };
    }

    const [{ data: connection }, { data: mailboxRows }, { data: leadRows }] = await Promise.all([
      db.from("instantly_connections").select("api_key, status").eq("user_id", context.userId).maybeSingle(),
      db.from("list_email_accounts").select("email_accounts(email_address, provider, status)").eq("list_id", list.id),
      db
        .from("list_leads")
        .select(
          "lead_id, emails, verification_status, lead:leads(email, first_name, last_name, org_name, title, phone)",
        )
        .eq("list_id", list.id),
    ]);
    if (!connection?.api_key || connection.status !== "active") throw new Error("Connect Instantly under Sending accounts first");

    const mailboxes = (mailboxRows ?? [])
      .map((row: any) => row.email_accounts)
      .filter((account: any) => account?.provider === "instantly" && account?.status === "active")
      .map((account: any) => account.email_address);
    if (!mailboxes.length) throw new Error("Choose at least one active Instantly mailbox in Campaign config");

    const emailReady = (leadRows ?? []).filter(
      (row: any) => row.lead?.email && Array.isArray(row.emails) && row.emails.length > 0,
    );
    const blockedByValidation = emailReady.filter(
      (row: any) => !["deliverable", "risky"].includes(row.verification_status),
    );
    if (blockedByValidation.length > 0) {
      throw new Error(
        `${blockedByValidation.length} prospect${
          blockedByValidation.length === 1 ? " is" : "s are"
        } not approved for sending. Validate emails and keep only Deliverable, or Deliverable + Risky, before launching.`,
      );
    }
    const prospects = emailReady;
    if (!prospects.length) throw new Error("Generate an email sequence for at least one prospect before launching");
    if (prospects.length > 1000) throw new Error("Campaign launch currently supports up to 1,000 prospects at a time");

    const stepCount = Math.max(...prospects.map((row: any) => row.emails.length));
    const sequences = [{
      steps: Array.from({ length: stepCount }, (_, index) => ({
        type: "email",
        delay: index === stepCount - 1 ? 0 : Math.max(1, Number(list.follow_up_delay_days ?? 3)),
        delay_unit: "days",
        variants: [{ subject: `{{nexus_subject_${index + 1}}}`, body: `{{nexus_body_${index + 1}}}` }],
      })),
    }];
    const footer = list.unsubscribe_footer_enabled && list.unsubscribe_footer_text
      ? `\n\n${String(list.unsubscribe_footer_text).trim()}`
      : "";
    const leads = prospects.map((row: any) => {
      const custom_variables: Record<string, string> = {};
      (row.emails as SequenceEmail[]).forEach((email, index) => {
        custom_variables[`nexus_subject_${index + 1}`] = String(email.subject ?? "").trim();
        custom_variables[`nexus_body_${index + 1}`] = `${String(email.body ?? "").trim()}${footer}`;
      });
      return {
        email: row.lead.email,
        first_name: row.lead.first_name,
        last_name: row.lead.last_name,
        company_name: row.lead.org_name,
        job_title: row.lead.title,
        phone: row.lead.phone,
        custom_variables,
      };
    });

    const created = await instantlyRequest(connection.api_key, "/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: `${list.name} — NexusAi`,
        campaign_schedule: {
          schedules: [{
            name: "Weekdays",
            timing: { from: String(list.sending_start_time).slice(0, 5), to: String(list.sending_end_time).slice(0, 5) },
            days: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), (list.sending_days as number[]).includes(day)])),
            timezone: list.sending_timezone,
          }],
        },
        sequences,
        email_list: mailboxes,
        email_gap: list.email_gap_minutes,
        daily_limit: 100,
        daily_max_leads: 100,
        stop_on_reply: true,
        stop_on_auto_reply: false,
        text_only: true,
        open_tracking: false,
        link_tracking: false,
        insert_unsubscribe_header: true,
      }),
    });
    const instantlyCampaignId = created?.id;
    if (typeof instantlyCampaignId !== "string") throw new Error("Instantly did not return a campaign ID");

    try {
      await instantlyRequest(connection.api_key, "/leads/add", {
        method: "POST",
        body: JSON.stringify({ campaign_id: instantlyCampaignId, leads, skip_if_in_workspace: false, skip_if_in_campaign: false }),
      });
      await instantlyRequest(connection.api_key, `/campaigns/${instantlyCampaignId}/activate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (error) {
      await instantlyRequest(connection.api_key, `/campaigns/${instantlyCampaignId}`, { method: "DELETE" }).catch(() => null);
      throw error;
    }

    const { error: updateError } = await db
      .from("lists")
      .update({ campaign_status: "active", launched_at: new Date().toISOString(), instantly_campaign_id: instantlyCampaignId })
      .eq("id", list.id)
      .eq("user_id", context.userId);
    if (updateError) throw new Error(updateError.message);
    return { status: "active" as const, resumed: false, prospects: leads.length };
  });

export const pauseCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: list } = await db
      .from("lists")
      .select("id, instantly_campaign_id")
      .eq("id", data.listId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!list?.instantly_campaign_id) throw new Error("This campaign has not been launched yet");
    const connection = await getConnection(db, context.userId);
    await instantlyRequest(connection.api_key, `/campaigns/${list.instantly_campaign_id}/pause`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const { error } = await db.from("lists").update({ campaign_status: "paused" }).eq("id", list.id);
    if (error) throw new Error(error.message);
    return { status: "paused" as const };
  });

async function getConnection(db: any, userId: string) {
  const { data } = await db.from("instantly_connections").select("api_key, status").eq("user_id", userId).maybeSingle();
  if (!data?.api_key || data.status !== "active") throw new Error("Connect Instantly under Sending accounts first");
  return data as { api_key: string; status: string };
}