import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { listPlans } from "@/lib/credits.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: "Pricing — NexusAi" },
      {
        name: "description",
        content:
          "Simple, transparent pricing for NexusAi. Basic, Professional, and Enterprise plans with monthly credits for outreach, enrichment, and AI agents.",
      },
    ],
  }),
});

type Cycle = "annual" | "quarterly";

const FEATURES: Record<string, string[]> = {
  basic: [
    "5,000 credits / month",
    "People search & contact pulls",
    "AI email & call-script generation",
    "Unlimited lead scoring",
    "Email + chat support",
  ],
  pro: [
    "10,000 credits / month",
    "Everything in Basic",
    "AI Voicemail agent (unlimited)",
    "AI SDR agent (unlimited replies)",
    "Priority support",
  ],
  enterprise: [
    "25,000 credits / month",
    "Everything in Professional",
    "Dedicated success manager",
    "Custom integrations",
    "SLA & onboarding",
  ],
};

function dollars(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function PricingPage() {
  const fetcher = useServerFn(listPlans);
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => fetcher() });
  const [cycle, setCycle] = useState<Cycle>("annual");

  return (
    <div className="dashboard-font min-h-screen bg-background">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gradient-aurora)]">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold">NexusAi</span>
        </Link>
        <Link
          to="/login"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-8">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Launch pricing — 50% off
          </div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Pricing built for outbound teams
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Pick a plan and start booking meetings today. Cancel anytime.
          </p>

          {/* Cycle toggle */}
          <div className="mt-8 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            {(["annual", "quarterly"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  cycle === c
                    ? "bg-[var(--gradient-aurora)] text-white shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c === "annual" ? "Annual (best value)" : "Quarterly"}
              </button>
            ))}
          </div>
        </div>

        {/* Tier cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {(plans ?? []).map((plan: any) => {
            const isAnnual = cycle === "annual";
            const priceCents = isAnnual ? plan.annual_price_cents : plan.quarterly_price_cents;
            const cadence = isAnnual ? "/ year" : "/ quarter";
            const original = priceCents * 2;
            const featured = plan.id === "pro";
            return (
              <div
                key={plan.id}
                className={`glass-panel-strong relative rounded-2xl p-6 ${
                  featured ? "ring-glow ring-2 ring-[oklch(0.78_0.16_210)]" : ""
                }`}
              >
                {featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--gradient-aurora)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                    Most popular
                  </div>
                )}
                <div className="mb-1 text-sm font-medium text-muted-foreground">
                  {plan.name}
                </div>
                <div className="mb-1 text-3xl font-semibold tracking-tight">
                  {plan.monthly_credits.toLocaleString()}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    credits / mo
                  </span>
                </div>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{dollars(priceCents)}</span>
                  <span className="text-sm text-muted-foreground">{cadence}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">
                    {dollars(original)}
                  </span>
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    50% off
                  </span>
                </div>
                {!isAnnual && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Billed every 4 months
                  </div>
                )}

                <ul className="my-6 space-y-2.5">
                  {FEATURES[plan.id]?.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button asChild className="w-full" variant={featured ? "default" : "outline"}>
                  <Link to="/login" search={{ plan: plan.id, cycle } as any}>
                    Get started
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Checkout & automated billing coming soon. Reach out to claim launch pricing.
        </p>
      </main>
    </div>
  );
}
