import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CreditAction = "pull_contacts" | "enrich" | "generate_email" | "activate_campaign";

export async function chargeUser(
  userId: string,
  action: CreditAction,
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