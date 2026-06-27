import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { resolveOrCreateCustomer } from "@/lib/payments.functions";
import { ORDER_PRICING, computeOrderTotals } from "@/lib/order-pricing";

// ---------------------------------------------------------------------------
// Done-for-you email-accounts orders.
//
// Reuses the EXISTING Stripe pattern: embedded checkout, subscription mode,
// managed_payments, payment confirmed by the signature-verified webhook.
// The order mixes a recurring mailbox subscription with one-time domain + setup
// charges (billed on the first invoice).
// ---------------------------------------------------------------------------

const mailboxSchema = z.object({
  account: z.string().min(1).max(64), // local part, e.g. "john" or "j.smith"
  display_name: z.string().max(120).optional(),
});

const domainSchema = z.object({
  name: z.string().min(1).max(120), // preferred domain root (admin confirms availability)
  tld: z.string().min(2).max(16), // e.g. "com", "org"
  mailboxes: z.array(mailboxSchema).min(1).max(50),
});

const orderConfigSchema = z.object({
  domains: z.array(domainSchema).min(1).max(50),
});
export type OrderConfig = z.infer<typeof orderConfigSchema>;

const checkoutInput = z.object({
  config: orderConfigSchema,
  terms_accepted: z.literal(true),
  environment: z.enum(["sandbox", "live"]),
  returnUrl: z.string().min(1),
});

type CheckoutResult = { clientSecret: string; orderId: string } | { error: string };

export const createOrderCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => checkoutInput.parse(i))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, claims, supabase } = context;
      const email = (claims as { email?: string } | undefined)?.email;
      const sb = supabase as any;

      const domainCount = data.config.domains.length;
      const mailboxCount = data.config.domains.reduce((n, d) => n + d.mailboxes.length, 0);
      if (mailboxCount < 1) return { error: "Add at least one mailbox." };
      const totals = computeOrderTotals(domainCount, mailboxCount);
      if (totals.monthlyCents <= 0 && totals.oneTimeCents <= 0) {
        return { error: "Nothing to charge — check your order." };
      }

      const env: StripeEnv = data.environment;
      const stripe = createStripeClient(env);
      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      // Save the order (pending) first so we have an id to put in Stripe metadata.
      const { data: order, error: insErr } = await sb
        .from("email_orders")
        .insert({
          user_id: userId,
          status: "pending",
          config: data.config,
          domain_count: domainCount,
          mailbox_count: mailboxCount,
          domain_cents: ORDER_PRICING.domainCents,
          mailbox_monthly_cents: ORDER_PRICING.mailboxMonthlyCents,
          setup_cents: ORDER_PRICING.setupFeeCents,
          one_time_cents: totals.oneTimeCents,
          monthly_cents: totals.monthlyCents,
          currency: ORDER_PRICING.currency,
          terms_accepted: true,
          terms_accepted_at: new Date().toISOString(),
          environment: env,
          stripe_customer_id: customerId,
        })
        .select("id")
        .single();
      if (insErr || !order) return { error: insErr?.message ?? "Could not save the order" };
      const orderId = order.id as string;

      // Recurring mailbox subscription + one-time domains (+ setup) on the first invoice.
      const line_items: any[] = [
        {
          price_data: {
            currency: ORDER_PRICING.currency,
            product_data: { name: "Email mailbox (managed)" },
            unit_amount: ORDER_PRICING.mailboxMonthlyCents,
            recurring: { interval: "month" },
          },
          quantity: mailboxCount,
        },
        {
          price_data: {
            currency: ORDER_PRICING.currency,
            product_data: { name: "Domain — done-for-you (first year)" },
            unit_amount: ORDER_PRICING.domainCents,
          },
          quantity: domainCount,
        },
      ];
      if (ORDER_PRICING.setupFeeCents > 0) {
        line_items.push({
          price_data: {
            currency: ORDER_PRICING.currency,
            product_data: { name: "One-time setup" },
            unit_amount: ORDER_PRICING.setupFeeCents,
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create({
        line_items,
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { userId, order_id: orderId, kind: "email_order", managed_payments: "true" },
        subscription_data: { metadata: { userId, order_id: orderId, kind: "email_order" } },
        managed_payments: { enabled: true },
      } as any);

      await sb
        .from("email_orders")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", orderId);

      return { clientSecret: session.client_secret ?? "", orderId };
    } catch (error) {
      console.error("createOrderCheckoutSession error:", error);
      return { error: getStripeErrorMessage(error) };
    }
  });

export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("email_orders")
      .select(
        "id, status, domain_count, mailbox_count, one_time_cents, monthly_cents, currency, created_at, paid_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { orders: (data ?? []) as OrderRow[] };
  });

export const getMyOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await (context.supabase as any)
      .from("email_orders")
      .select(
        "id, status, config, domain_count, mailbox_count, one_time_cents, monthly_cents, currency, created_at, paid_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    return { order };
  });

export type OrderRow = {
  id: string;
  status: string;
  domain_count: number;
  mailbox_count: number;
  one_time_cents: number;
  monthly_cents: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
};
