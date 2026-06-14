import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Instantly integration: connect a user's Instantly account by API key, then
// import their connected sending mailboxes into email_accounts so SDR agents
// can send through them. The API key is stored per-user (RLS-locked) and is
// NEVER returned to the browser.
// ---------------------------------------------------------------------------

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

type InstantlyMailbox = {
  email: string;
  display_name: string | null;
};

// Pull every connected sending account from Instantly (paginated, capped).
async function fetchInstantlyAccounts(apiKey: string): Promise<InstantlyMailbox[]> {
  const out: InstantlyMailbox[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < 25; page++) {
    const url = new URL(`${INSTANTLY_BASE}/accounts`);
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Instantly rejected that API key. Double-check it and try again.");
    }
    if (!res.ok) {
      throw new Error(`Instantly API error ${res.status}. Try again in a moment.`);
    }

    const json: any = await res.json();
    const items: any[] = Array.isArray(json) ? json : (json.items ?? json.data ?? []);
    for (const it of items) {
      const email = it?.email ?? it?.eaccount ?? it?.email_address;
      if (!email) continue;
      const name =
        [it?.first_name, it?.last_name].filter(Boolean).join(" ") ||
        it?.display_name ||
        null;
      out.push({ email: String(email).trim().toLowerCase(), display_name: name });
    }

    const next = json?.next_starting_after ?? json?.pagination?.next_starting_after;
    if (!next || items.length === 0) break;
    startingAfter = String(next);
  }

  // De-dupe by email.
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.email) ? false : (seen.add(m.email), true)));
}

// Upsert imported mailboxes into email_accounts as provider "instantly".
async function importMailboxes(
  supabase: any,
  userId: string,
  mailboxes: InstantlyMailbox[],
): Promise<number> {
  if (!mailboxes.length) return 0;
  const rows = mailboxes.map((m) => ({
    user_id: userId,
    provider: "instantly",
    email_address: m.email,
    display_name: m.display_name,
    status: "active",
    auth_method: "instantly",
  }));
  const { error } = await supabase
    .from("email_accounts")
    .upsert(rows, { onConflict: "user_id,email_address" });
  if (error) throw new Error(error.message);
  return rows.length;
}

const tableMissing = (msg: string) =>
  /instantly_connections/i.test(msg) && /(does not exist|relation|schema cache|not find)/i.test(msg);

// ---------- Outbound: send a threaded reply through Instantly ----------

// List recent emails for a mailbox (used to find the inbound email to reply to).
export async function instantlyListEmails(apiKey: string, eaccount: string): Promise<any[]> {
  try {
    const url = new URL(`${INSTANTLY_BASE}/emails`);
    url.searchParams.set("eaccount", eaccount);
    url.searchParams.set("limit", "30");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return Array.isArray(json) ? json : (json.items ?? json.data ?? []);
  } catch {
    return [];
  }
}

// POST a reply to an existing Instantly email. Throws on failure.
export async function instantlySendReply(opts: {
  apiKey: string;
  eaccount: string;
  replyToUuid: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const res = await fetch(`${INSTANTLY_BASE}/emails/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      eaccount: opts.eaccount,
      reply_to_uuid: opts.replyToUuid,
      subject: opts.subject,
      body: { text: opts.text, ...(opts.html ? { html: opts.html } : {}) },
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Instantly rejected the send — check your API key and that it has email send scope.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Instantly send failed (${res.status})${t ? `: ${t.slice(0, 200)}` : ""}`);
  }
}

export const connectInstantly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ api_key: z.string().min(10).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const sb = supabase as any;
    const apiKey = data.api_key.trim();

    // Validate the key by actually pulling the account list.
    const mailboxes = await fetchInstantlyAccounts(apiKey);

    const { error: cErr } = await sb.from("instantly_connections").upsert(
      {
        user_id: userId,
        api_key: apiKey,
        status: "active",
        account_count: mailboxes.length,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (cErr) {
      if (tableMissing(cErr.message)) {
        throw new Error(
          "Instantly storage isn't live in the database yet (migration still applying). Try again in a minute.",
        );
      }
      throw new Error(cErr.message);
    }

    const imported = await importMailboxes(sb, userId, mailboxes);
    return { connected: true, imported };
  });

export const getInstantlyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("instantly_connections")
      .select("status, account_count, last_synced_at, workspace_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error || !data) return { connected: false as const };
    return {
      connected: true as const,
      status: data.status as string,
      account_count: (data.account_count as number) ?? 0,
      last_synced_at: (data.last_synced_at as string) ?? null,
      workspace_name: (data.workspace_name as string) ?? null,
    };
  });

export const syncInstantlyAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    const sb = supabase as any;
    const { data: conn, error } = await sb
      .from("instantly_connections")
      .select("api_key")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !conn?.api_key) {
      throw new Error("Connect your Instantly account first.");
    }
    const mailboxes = await fetchInstantlyAccounts(conn.api_key);
    const imported = await importMailboxes(sb, userId, mailboxes);
    await sb
      .from("instantly_connections")
      .update({
        account_count: mailboxes.length,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return { imported };
  });

export const disconnectInstantly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { error } = await sb
      .from("instantly_connections")
      .delete()
      .eq("user_id", context.userId);
    if (error && !tableMissing(error.message)) throw new Error(error.message);
    return { ok: true };
  });
