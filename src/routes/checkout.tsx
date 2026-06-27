import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { ArrowLeft } from "lucide-react";

const VALID_PRICES = new Set(["basic_annual", "pro_annual", "enterprise_annual"]);

export const Route = createFileRoute("/checkout")({
  validateSearch: (s: Record<string, unknown>) => ({
    priceId: typeof s.priceId === "string" ? s.priceId : "pro_annual",
  }),
  component: CheckoutPage,
  head: () => ({ meta: [{ title: "Checkout" }] }),
});

function CheckoutPage() {
  const { priceId } = Route.useSearch();
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        nav({ to: "/login", search: { plan: priceId } as any });
      } else {
        setChecking(false);
      }
    });
  }, [nav, priceId]);

  if (checking) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>
    );
  }

  const safePriceId = VALID_PRICES.has(priceId) ? priceId : "pro_annual";

  return (
    <div className="dashboard-font min-h-screen bg-background">
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          to="/pricing"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to pricing
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Complete your subscription</h1>
        <p className="text-sm text-muted-foreground mb-6">
          You're subscribing to the{" "}
          <span className="font-medium text-foreground">{labelFor(safePriceId)}</span> plan. Credits
          are granted instantly after payment.
        </p>
        <div className="glass-panel rounded-2xl overflow-hidden">
          <StripeEmbeddedCheckout priceId={safePriceId} />
        </div>
      </div>
    </div>
  );
}

function labelFor(priceId: string) {
  if (priceId.startsWith("basic")) return "Basic";
  if (priceId.startsWith("pro")) return "Scale";
  if (priceId.startsWith("enterprise")) return "Enterprise";
  return priceId;
}
