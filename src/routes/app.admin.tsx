import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getAdminOverview,
  listAdminCustomers,
  type AdminOverview,
  type AdminCustomer,
} from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Users, Repeat, Zap } from "lucide-react";

export const Route = createFileRoute("/app/admin")({
  component: AdminDashboard,
});

function fmtCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function AdminDashboard() {
  const nav = useNavigate();
  const fetchOverview = useServerFn(getAdminOverview);
  const fetchCustomers = useServerFn(listAdminCustomers);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    Promise.all([fetchOverview(), fetchCustomers()])
      .then(([o, c]) => {
        if (cancel) return;
        setOverview(o);
        setCustomers(c);
      })
      .catch((e) => {
        if (cancel) return;
        if (String(e?.message ?? "").includes("Forbidden")) {
          nav({ to: "/app/people" });
          return;
        }
        setError(String(e?.message ?? e));
      });
    return () => {
      cancel = true;
    };
  }, [fetchOverview, fetchCustomers, nav]);

  if (error) {
    return (
      <div className="p-8 text-sm text-destructive">Failed to load admin: {error}</div>
    );
  }
  if (!overview || !customers) {
    return <div className="p-8 text-sm text-muted-foreground">Loading admin dashboard…</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Revenue, subscriptions, and customer usage across the platform.
        </p>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<DollarSign className="h-4 w-4" />}
          label="MRR"
          value={fmtCents(overview.mrrCents)}
          sub={`ARR ${fmtCents(overview.arrCents)}`}
        />
        <Kpi
          icon={<Repeat className="h-4 w-4" />}
          label="Active subscriptions"
          value={overview.activeSubscriptions.toLocaleString()}
          sub={`${overview.totalCustomers.toLocaleString()} total accounts`}
        />
        <Kpi
          icon={<Users className="h-4 w-4" />}
          label="Credits granted"
          value={overview.totalCreditsGranted.toLocaleString()}
        />
        <Kpi
          icon={<Zap className="h-4 w-4" />}
          label="Credits spent"
          value={overview.totalCreditsSpent.toLocaleString()}
          sub={`${
            overview.totalCreditsGranted > 0
              ? Math.round(
                  (overview.totalCreditsSpent / overview.totalCreditsGranted) * 100,
                )
              : 0
          }% utilization`}
        />
      </div>

      {/* By plan */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">Revenue by plan</h2>
        {overview.byPlan.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active paid subscriptions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Subscribers</TableHead>
                <TableHead className="text-right">MRR</TableHead>
                <TableHead className="text-right">ARR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.byPlan.map((p) => (
                <TableRow key={p.planId}>
                  <TableCell className="font-medium">{p.planName}</TableCell>
                  <TableCell className="text-right">{p.count}</TableCell>
                  <TableCell className="text-right">{fmtCents(p.mrrCents)}</TableCell>
                  <TableCell className="text-right">{fmtCents(p.mrrCents * 12)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Customers */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">
          Customers ({customers.length.toLocaleString()})
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead className="text-right">Credits spent</TableHead>
                <TableHead>Renews</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.userId}>
                  <TableCell className="max-w-[240px] truncate">
                    <div className="font-medium">{c.email ?? "—"}</div>
                    {c.fullName && (
                      <div className="text-xs text-muted-foreground">{c.fullName}</div>
                    )}
                  </TableCell>
                  <TableCell>{c.planName ?? <span className="text-muted-foreground">Free</span>}</TableCell>
                  <TableCell>
                    {c.status ? (
                      <Badge
                        variant={c.status === "active" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {c.status}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{c.billingCycle ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {c.creditsSpent.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {c.currentPeriodEnd
                      ? new Date(c.currentPeriodEnd).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-white/5">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
