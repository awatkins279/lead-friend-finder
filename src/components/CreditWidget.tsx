import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Sparkles, Infinity as InfinityIcon } from "lucide-react";
import { getCreditSummary } from "@/lib/credits.functions";

export function CreditWidget() {
  const fetcher = useServerFn(getCreditSummary);
  const { data } = useQuery({
    queryKey: ["credit-summary"],
    queryFn: () => fetcher(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data || data.unavailable) return null;

  // Owner / admin → unlimited badge, no progress bar, no upgrade CTA
  if (data.isAdmin) {
    return (
      <div className="glass-panel mb-3 rounded-xl p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--gradient-aurora)] text-white">
            <InfinityIcon className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1">Owner</span>
          <span className="text-muted-foreground">Unlimited</span>
        </div>
      </div>
    );
  }

  // No subscription → upsell to pricing
  if (!data.hasSubscription) {
    return (
      <Link
        to="/pricing"
        className="glass-panel mb-3 block rounded-xl p-3 transition-colors hover:bg-white/5"
      >
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          <span>No active plan</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Choose a plan to start using credits →
        </div>
      </Link>
    );
  }

  const pct = data.allowance > 0 ? Math.min(100, (data.used / data.allowance) * 100) : 0;
  const lowOnCredits = data.remaining < data.allowance * 0.15;

  return (
    <div className="glass-panel mb-3 rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">{data.planName}</span>
        <span className="text-muted-foreground">
          {data.remaining.toLocaleString()} left
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full transition-all ${
            lowOnCredits
              ? "bg-gradient-to-r from-amber-500 to-rose-500"
              : "bg-[var(--gradient-aurora)]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>{data.used.toLocaleString()} used</span>
        <span>{data.allowance.toLocaleString()} / mo</span>
      </div>
    </div>
  );
}
