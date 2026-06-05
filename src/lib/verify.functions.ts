import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
});

// MillionVerifier result codes:
//   ok           -> deliverable
//   catch_all    -> risky
//   unknown      -> unknown
//   disposable   -> disposable (treat as invalid for filtering)
//   invalid      -> invalid
//   error        -> unknown (will be refunded)
function mapStatus(result: string): "deliverable" | "risky" | "invalid" | "disposable" | "unknown" {
  switch (result) {
    case "ok":
      return "deliverable";
    case "catch_all":
      return "risky";
    case "invalid":
      return "invalid";
    case "disposable":
      return "disposable";
    default:
      return "unknown";
  }
}

export const verifyLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Look up the lead's email
    const { data: row, error: rowErr } = await supabase
      .from("list_leads")
      .select("lead_id, lead:leads(email)")
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row) throw new Error("Lead not in this list");
    const email = (row as any).lead?.email as string | null;
    if (!email) {
      await supabase
        .from("list_leads")
        .update({
          verification_status: "invalid",
          verification_result: "no_email",
          verification_quality: "bad",
          verified_at: new Date().toISOString(),
        })
        .eq("list_id", data.listId)
        .eq("lead_id", data.leadId);
      return { ok: true as const, status: "invalid", result: "no_email", charged: false };
    }

    const apiKey = process.env.MILLIONVERIFIER_API_KEY;
    if (!apiKey) throw new Error("Missing MILLIONVERIFIER_API_KEY");

    // Charge 1 credit up front (admin bypass automatic). spend_credits prefixes 'spend:' internally.
    const { error: chargeErr } = await supabaseAdmin.rpc("spend_credits", {
      _user_id: userId,
      _action: "verify_email",
      _amount: 1,
      _note: `verify:${data.leadId}`,
    });
    if (chargeErr) {
      throw new Error(chargeErr.message);
    }

    // Call MillionVerifier single-email API
    const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
    let mvResult = "error";
    let mvQuality = "bad";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MV HTTP ${res.status}`);
      const payload = await res.json();
      mvResult = String(payload?.result ?? "error");
      mvQuality = String(payload?.quality ?? "bad");
    } catch (err: any) {
      // Refund the credit on hard error so user isn't charged for our failure
      await supabaseAdmin.from("credit_ledger").insert({
        user_id: userId,
        amount: 1,
        action: "refund:verify_email",
        period_start: new Date().toISOString(),
        note: `refund verify error: ${String(err?.message ?? "unknown").slice(0, 200)}`,
      });
      throw new Error(`Verification failed: ${err?.message ?? "unknown"}`);
    }

    const status = mapStatus(mvResult);
    const { error: updErr } = await supabase
      .from("list_leads")
      .update({
        verification_status: status,
        verification_result: mvResult,
        verification_quality: mvQuality,
        verified_at: new Date().toISOString(),
      })
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, status, result: mvResult, quality: mvQuality, charged: true };
  });
