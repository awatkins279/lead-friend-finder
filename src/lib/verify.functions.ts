import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
});

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

async function verifyOneEmail(apiKey: string, email: string) {
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MV HTTP ${res.status}`);
  const payload = await res.json();
  return {
    result: String(payload?.result ?? "error"),
    quality: String(payload?.quality ?? "bad"),
  };
}

// ---------- Single-list-lead verifier (existing) ----------

export const verifyLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

    const { error: chargeErr } = await supabaseAdmin.rpc("spend_credits", {
      _user_id: userId,
      _action: "verify_email",
      _amount: 1,
      _note: `verify:${data.leadId}`,
    });
    if (chargeErr) throw new Error(chargeErr.message);

    let mvResult = "error";
    let mvQuality = "bad";
    try {
      const r = await verifyOneEmail(apiKey, email);
      mvResult = r.result;
      mvQuality = r.quality;
    } catch (err: any) {
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
    await supabase
      .from("list_leads")
      .update({
        verification_status: status,
        verification_result: mvResult,
        verification_quality: mvQuality,
        verified_at: new Date().toISOString(),
      })
      .eq("list_id", data.listId)
      .eq("lead_id", data.leadId);

    // Also write to the per-user lead_verifications cache
    await supabaseAdmin.from("lead_verifications").upsert({
      user_id: userId,
      lead_id: data.leadId,
      status,
      result: mvResult,
      quality: mvQuality,
      email,
      verified_at: new Date().toISOString(),
    });

    return { ok: true as const, status, result: mvResult, quality: mvQuality, charged: true };
  });

// ---------- Bulk verifier for /people (no list context) ----------

const BulkInput = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(50),
});

export type BulkVerifyResult = {
  leadId: string;
  status: "deliverable" | "risky" | "invalid" | "disposable" | "unknown";
  result: string;
};

export const verifyLeadEmailsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BulkInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const apiKey = process.env.MILLIONVERIFIER_API_KEY;
    if (!apiKey) throw new Error("Missing MILLIONVERIFIER_API_KEY");

    // Look up emails for these leads
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id,email")
      .in("id", data.leadIds);
    if (leadsErr) throw new Error(leadsErr.message);

    // Skip leads that have already been verified by this user
    const { data: existing } = await supabaseAdmin
      .from("lead_verifications")
      .select("lead_id,status,result,email")
      .eq("user_id", userId)
      .in("lead_id", data.leadIds);
    const cached = new Map<string, { status: string; result: string; email: string | null }>();
    for (const row of existing ?? []) {
      cached.set(row.lead_id as string, {
        status: row.status as string,
        result: (row.result as string) ?? "",
        email: (row.email as string | null) ?? null,
      });
    }

    const results: BulkVerifyResult[] = [];
    const toVerify: { id: string; email: string }[] = [];

    for (const l of leads ?? []) {
      const id = l.id as string;
      const email = (l.email as string | null) ?? "";
      const c = cached.get(id);
      if (c && c.email?.toLowerCase() === email.toLowerCase()) {
        results.push({ leadId: id, status: c.status as any, result: c.result });
        continue;
      }
      if (!email) {
        results.push({ leadId: id, status: "invalid", result: "no_email" });
        await supabaseAdmin.from("lead_verifications").upsert({
          user_id: userId,
          lead_id: id,
          status: "invalid",
          result: "no_email",
          quality: "bad",
          email: null,
          verified_at: new Date().toISOString(),
        });
        continue;
      }
      toVerify.push({ id, email });
    }

    if (toVerify.length === 0) {
      return { results, charged: 0, skipped: results.length };
    }

    // Charge up front; refund per-failure below
    const { error: chargeErr } = await supabaseAdmin.rpc("spend_credits", {
      _user_id: userId,
      _action: "verify_email",
      _amount: toVerify.length,
      _note: `verify_batch:${toVerify.length}`,
    });
    if (chargeErr) throw new Error(chargeErr.message);

    // Run all MV calls in parallel
    const verified = await Promise.all(
      toVerify.map(async ({ id, email }) => {
        try {
          const r = await verifyOneEmail(apiKey, email);
          return { id, email, ...r, ok: true as const };
        } catch (err: any) {
          return {
            id,
            email,
            result: "error",
            quality: "bad",
            ok: false as const,
            err: String(err?.message ?? "unknown"),
          };
        }
      }),
    );

    let refunds = 0;
    const rowsToUpsert: any[] = [];
    for (const v of verified) {
      const status = mapStatus(v.result);
      if (!v.ok) refunds += 1;
      results.push({ leadId: v.id, status, result: v.result });
      rowsToUpsert.push({
        user_id: userId,
        lead_id: v.id,
        status,
        result: v.result,
        quality: v.quality,
        email: v.email,
        verified_at: new Date().toISOString(),
      });
    }

    if (rowsToUpsert.length > 0) {
      await supabaseAdmin.from("lead_verifications").upsert(rowsToUpsert);
    }

    if (refunds > 0) {
      await supabaseAdmin.from("credit_ledger").insert({
        user_id: userId,
        amount: refunds,
        action: "refund:verify_email",
        period_start: new Date().toISOString(),
        note: `refund ${refunds} failed MV calls in batch`,
      });
    }

    return {
      results,
      charged: toVerify.length - refunds,
      skipped: results.length - toVerify.length,
    };
  });

// ---------- Load cached verifications for a set of lead ids ----------

const LoadInput = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(5000),
});

export const loadLeadVerifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LoadInput.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("lead_verifications")
      .select("lead_id,status,result,email")
      .eq("user_id", userId)
      .in("lead_id", data.leadIds);
    if (error) throw new Error(error.message);
    const { data: leads, error: leadsError } = await context.supabase
      .from("leads")
      .select("id,email")
      .in("id", data.leadIds);
    if (leadsError) throw new Error(leadsError.message);
    const currentEmails = new Map(
      (leads ?? []).map((lead) => [lead.id, lead.email?.toLowerCase() ?? null]),
    );
    return {
      verifications: (rows ?? []).filter(
        (row) => currentEmails.get(row.lead_id) === row.email?.toLowerCase(),
      ),
    };
  });
