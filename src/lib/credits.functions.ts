import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

export type CreditSummary = {
  isAdmin: boolean;
  planId: string | null;
  planName: string;
  allowance: number;
  used: number;
  remaining: number;
  periodStart: string | null;
  periodEnd: string | null;
  byAction: Record<string, number>;
  hasSubscription: boolean;
};

export const getCreditSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreditSummary> => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin.rpc("get_credit_summary", { _user_id: userId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) && data.length ? (data[0] as any) : null;
    if (!row) {
      return {
        isAdmin: false,
        planId: null,
        planName: "No plan",
        allowance: 0,
        used: 0,
        remaining: 0,
        periodStart: null,
        periodEnd: null,
        byAction: {},
        hasSubscription: false,
      };
    }
    return {
      isAdmin: !!row.is_admin,
      planId: row.plan_id,
      planName: row.plan_name,
      allowance: row.allowance ?? 0,
      used: row.used ?? 0,
      remaining: row.remaining ?? 0,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      byAction: row.by_action ?? {},
      hasSubscription: !!row.plan_id || !!row.is_admin,
    };
  });

export const listPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return data ?? [];
});

const SpendInput = z.object({
  action: z.enum(["pull_contacts", "enrich", "generate_email", "activate_campaign"]),
  units: z.number().int().min(1).max(100000),
  note: z.string().max(500).optional(),
});

/**
 * Server-callable spend. Returns remaining after spend.
 * Admin users bypass automatically (RPC returns 999999999).
 * Throws `insufficient_credits` or `no_active_subscription` on failure.
 */
export const spendCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SpendInput.parse(input))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { data: costRow, error: costErr } = await supabaseAdmin
      .from("credit_costs")
      .select("cost_per_unit")
      .eq("action", data.action)
      .single();
    if (costErr) throw new Error(costErr.message);
    const totalCost = (costRow?.cost_per_unit ?? 0) * data.units;
    if (totalCost <= 0) return { remaining: 0, charged: 0 };

    const { data: rem, error } = await supabaseAdmin.rpc("spend_credits", {
      _user_id: userId,
      _action: data.action,
      _amount: totalCost,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { remaining: rem as number, charged: totalCost };
  });

/** Internal helper for other server fns. Throws on failure. */
export async function chargeUser(
  userId: string,
  action: "pull_contacts" | "enrich" | "generate_email" | "activate_campaign",
  units: number,
  note?: string,
) {
  const { data: costRow } = await supabaseAdmin
    .from("credit_costs")
    .select("cost_per_unit")
    .eq("action", action)
    .single();
  const totalCost = (costRow?.cost_per_unit ?? 0) * units;
  if (totalCost <= 0) return;
  const { error } = await supabaseAdmin.rpc("spend_credits", {
    _user_id: userId,
    _action: action,
    _amount: totalCost,
    _note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
}
