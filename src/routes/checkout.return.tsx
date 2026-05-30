import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
  head: () => ({ meta: [{ title: "Welcome — your subscription is active" }] }),
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  return (
    <div className="dashboard-font min-h-screen bg-background grid place-items-center px-6">
      <div className="glass-panel-strong max-w-md w-full rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">You're in.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {session_id
            ? "Your subscription is being activated. Credits will appear in your dashboard within a few seconds."
            : "Checkout complete — head to your dashboard to get started."}
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/app">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
