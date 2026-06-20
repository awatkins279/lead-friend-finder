import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { instantlyAddAccount, type InstantlyMailboxCreds } from "@/lib/instantly.functions";

// All functions here are ADMIN-only and use the service-role client (bypasses RLS),
// matching this project's existing admin pattern (admin.functions.ts).

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---- Fulfillment data shape (the real created domains + mailbox credentials) ----
const mailboxFulfillSchema = z.object({
  email: z.string().email(),
  display_name: z.string().max(120).optional().or(z.literal("")),
  first_name: z.string().max(80).optional().or(z.literal("")),
  last_name: z.string().max(80).optional().or(z.literal("")),
  provider_code: z.union([z.string(), z.number()]).optional(),
  smtp_host: z.string().max(200),
  smtp_port: z.coerce.number().int().min(1).max(65535),
  smtp_username: z.string().max(200),
  smtp_password: z.string().max(400),
  imap_host: z.string().max(200),
  imap_port: z.coerce.number().int().min(1).max(65535),
  imap_username: z.string().max(200),
  imap_password: z.string().max(400),
});
const fulfillmentSchema = z.object({
  domains: z.array(z.object({ domain: z.string().min(1).max(200) })).optional(),
  mailboxes: z.array(mailboxFulfillSchema).max(200),
});
export type OrderFulfillment = z.infer<typeof fulfillmentSchema>;

export type AdminOrder = {
  id: string;
  user_id: string;
  customer_email: string | null;
  customer_name: string | null;
  status: string;
  config: any;
  fulfillment: any;
  domain_count: number;
  mailbox_count: number;
  one_time_cents: number;
  monthly_cents: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
};

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ orders: AdminOrder[] }> => {
    await assertAdmin(context.userId);
    const { data: orders, error } = await supabaseAdmin
      .from("email_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (orders ?? []) as any[];
    const ids = [...new Set(rows.map((o) => o.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return {
      orders: rows.map((o) => ({
        ...o,
        customer_email: pmap.get(o.user_id)?.email ?? null,
        customer_name: pmap.get(o.user_id)?.full_name ?? null,
      })) as AdminOrder[],
    };
  });

const STATUSES = ["pending", "paid", "in_progress", "completed", "canceled"] as const;

export const updateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ orderId: z.string().uuid(), status: z.enum(STATUSES) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("email_orders")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveOrderFulfillment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ orderId: z.string().uuid(), fulfillment: fulfillmentSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("email_orders")
      .update({ fulfillment: data.fulfillment, updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Push the order's created mailboxes into the (admin's) central Instantly workspace.
export const pushOrderToInstantly = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ orderId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // The central Instantly account = the admin's own instantly_connections row.
    const { data: conn } = await (supabaseAdmin as any)
      .from("instantly_connections")
      .select("api_key")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn?.api_key) throw new Error("Connect your Instantly account first (Sending accounts).");

    const { data: order } = await supabaseAdmin
      .from("email_orders")
      .select("fulfillment")
      .eq("id", data.orderId)
      .maybeSingle();
    const mailboxes = ((order as any)?.fulfillment?.mailboxes ?? []) as InstantlyMailboxCreds[];
    if (!mailboxes.length) throw new Error("Record the mailboxes (with SMTP/IMAP) first.");

    const results: { email: string; ok: boolean; error?: string }[] = [];
    for (const m of mailboxes) {
      const r = await instantlyAddAccount(conn.api_key as string, m);
      results.push({ email: m.email, ok: r.ok, error: r.ok ? undefined : r.error });
    }
    const allOk = results.every((r) => r.ok);
    return { ok: allOk, results };
  });

// Assign the created mailboxes to the customer's account (so they show in the
// customer's dashboard) and mark the order completed. Passwords are NOT stored on
// the customer-readable email_accounts row.
export const assignOrderToCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ orderId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: order } = await supabaseAdmin
      .from("email_orders")
      .select("user_id, fulfillment")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("Order not found");
    const mailboxes = ((order as any).fulfillment?.mailboxes ?? []) as Array<
      InstantlyMailboxCreds & { display_name?: string }
    >;
    if (!mailboxes.length) throw new Error("Record the mailboxes first.");

    // NOTE: smtp_password / imap_password are deliberately NOT written here — this
    // row is customer-readable via RLS, so passwords stay only on the order.
    const rows = mailboxes.map((m) => ({
      user_id: (order as any).user_id,
      provider: "instantly",
      email_address: m.email.toLowerCase(),
      display_name: m.display_name || null,
      status: "active",
      auth_method: "instantly",
      smtp_host: m.smtp_host || null,
      smtp_port: m.smtp_port ?? null,
      smtp_username: m.smtp_username || null,
      imap_host: m.imap_host || null,
      imap_port: m.imap_port ?? null,
    }));
    const { error: upErr } = await supabaseAdmin
      .from("email_accounts")
      .upsert(rows as any, { onConflict: "user_id,email_address" });
    if (upErr) throw new Error(upErr.message);

    const { error: stErr } = await supabaseAdmin
      .from("email_orders")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    if (stErr) throw new Error(stErr.message);

    return { ok: true, assigned: rows.length };
  });
