import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Feature flags gated by plan tier
export type PlanFeatures = {
  max_contacts_per_campaign: number;
  max_email_accounts: number;
  max_phone_accounts: number;
  max_sdr_agents: number;
  ai_email_generation: boolean;
  ai_call_scripts: boolean;
  ai_auto_reply: boolean;
  live_call_coaching: boolean;
  call_recording: boolean;
  advanced_scoring: boolean;
  export_csv: boolean;
  white_label: boolean;
};

const PLAN_FEATURES: Record<string, PlanFeatures> = {
  basic: {
    max_contacts_per_campaign: 5000,
    max_email_accounts: 1,
    max_phone_accounts: 1,
    max_sdr_agents: 1,
    ai_email_generation: true,
    ai_call_scripts: false,
    ai_auto_reply: false,
    live_call_coaching: false,
    call_recording: false,
    advanced_scoring: false,
    export_csv: true,
    white_label: false,
  },
  pro: {
    max_contacts_per_campaign: 25000,
    max_email_accounts: 3,
    max_phone_accounts: 2,
    max_sdr_agents: 3,
    ai_email_generation: true,
    ai_call_scripts: true,
    ai_auto_reply: true,
    live_call_coaching: true,
    call_recording: true,
    advanced_scoring: true,
    export_csv: true,
    white_label: false,
  },
  enterprise: {
    max_contacts_per_campaign: 100000,
    max_email_accounts: 10,
    max_phone_accounts: 10,
    max_sdr_agents: 10,
    ai_email_generation: true,
    ai_call_scripts: true,
    ai_auto_reply: true,
    live_call_coaching: true,
    call_recording: true,
    advanced_scoring: true,
    export_csv: true,
    white_label: true,
  },
};

export const getPlanFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ isAdmin: boolean; plan: string | null; features: PlanFeatures }> => {
      const { supabase, userId } = context;

      // Check if admin
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (role) {
        // Admins get enterprise features
        return {
          isAdmin: true,
          plan: "admin",
          features: PLAN_FEATURES.enterprise,
        };
      }

      // Check subscription
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan_id, status")
        .eq("user_id", userId)
        .in("status", ["active", "trialing"])
        .maybeSingle();

      const planId = sub?.plan_id || "basic";
      const features = PLAN_FEATURES[planId] || PLAN_FEATURES.basic;

      return {
        isAdmin: false,
        plan: planId,
        features,
      };
    },
  );

export const checkFeatureAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ feature: z.string() }).parse(i))
  .handler(async ({ data, context }): Promise<{ allowed: boolean; reason?: string }> => {
    const { supabase, userId } = context;

    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (role) return { allowed: true };

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan_id")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    const planId = sub?.plan_id || "basic";
    const features = PLAN_FEATURES[planId] || PLAN_FEATURES.basic;
    const key = data.feature as keyof PlanFeatures;

    if (features[key] === false) {
      return {
        allowed: false,
        reason: `This feature requires the Pro plan or higher. Your plan: ${planId}`,
      };
    }

    return { allowed: true };
  });
