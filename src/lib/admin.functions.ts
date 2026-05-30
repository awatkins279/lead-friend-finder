import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type AdminOverview = {
  totalCustomers: number;
  activeSubscriptions: number;
  mrrCents: number;
  arrCents: number;
  totalCreditsGranted: number;
  totalCreditsSpent: number;
  byPlan: Array<{ planId: string; planName: string; count: number; mrrCents: number }>;
};

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    await assertAdmin(context.userId);

    const [{ data: subs }, { data: plans }, { data: ledger }, { count: customerCount }] =
      await Promise.all([
        supabaseAdmin.from("subscriptions").select("plan_id, billing_cycle, status, user_id"),
        supabaseAdmin.from("plans").select("id, name, annual_price_cents, quarterly_price_cents, monthly_credits"),
        supabaseAdmin.from("credit_ledger").select("amount"),
        supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      ]);

    const planMap = new Map((plans ?? []).map((p: any) => [p.id, p]));
    const active = (subs ?? []).filter((s: any) => s.status === "active" || s.status === "trialing");

    let mrrCents = 0;
    const byPlanMap = new Map<string, { planId: string; planName: string; count: number; mrrCents: number }>();
    for (const s of active) {
      const plan: any = planMap.get(s.plan_id);
      if (!plan) continue;
      const annual = plan.annual_price_cents ?? 0;
      const quarterly = plan.quarterly_price_cents ?? 0;
      const monthly =
        s.billing_cycle === "quarterly"
          ? Math.round(quarterly / 3)
          : Math.round(annual / 12);
      mrrCents += monthly;
      const entry = byPlanMap.get(plan.id) ?? {
        planId: plan.id,
        planName: plan.name,
        count: 0,
        mrrCents: 0,
      };
      entry.count += 1;
      entry.mrrCents += monthly;
      byPlanMap.set(plan.id, entry);
    }

    let granted = 0;
    let spent = 0;
    for (const l of ledger ?? []) {
      if (l.amount > 0) granted += l.amount;
      else spent += -l.amount;
    }

    return {
      totalCustomers: customerCount ?? 0,
      activeSubscriptions: active.length,
      mrrCents,
      arrCents: mrrCents * 12,
      totalCreditsGranted: granted,
      totalCreditsSpent: spent,
      byPlan: Array.from(byPlanMap.values()).sort((a, b) => b.mrrCents - a.mrrCents),
    };
  });

export type AdminCustomer = {
  userId: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  planId: string | null;
  planName: string | null;
  billingCycle: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  creditsSpent: number;
};

export const listAdminCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminCustomer[]> => {
    await assertAdmin(context.userId);

    const [{ data: profiles }, { data: subs }, { data: plans }, { data: ledger }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabaseAdmin.from("subscriptions").select("*"),
        supabaseAdmin.from("plans").select("id, name"),
        supabaseAdmin.from("credit_ledger").select("user_id, amount"),
      ]);

    const planMap = new Map((plans ?? []).map((p: any) => [p.id, p.name]));
    const subMap = new Map<string, any>();
    for (const s of subs ?? []) {
      const existing = subMap.get(s.user_id);
      if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
        subMap.set(s.user_id, s);
      }
    }
    const spendMap = new Map<string, number>();
    for (const l of ledger ?? []) {
      if (l.amount < 0) {
        spendMap.set(l.user_id, (spendMap.get(l.user_id) ?? 0) + -l.amount);
      }
    }

    return (profiles ?? []).map((p: any) => {
      const s = subMap.get(p.id);
      return {
        userId: p.id,
        email: p.email,
        fullName: p.full_name,
        createdAt: p.created_at,
        planId: s?.plan_id ?? null,
        planName: s?.plan_id ? planMap.get(s.plan_id) ?? s.plan_id : null,
        billingCycle: s?.billing_cycle ?? null,
        status: s?.status ?? null,
        currentPeriodEnd: s?.current_period_end ?? null,
        creditsSpent: spendMap.get(p.id) ?? 0,
      };
    });
  });

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAdmin: boolean }> => {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });
