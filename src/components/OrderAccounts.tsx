import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createOrderCheckoutSession, listMyOrders, type OrderRow } from "@/lib/order.functions";
import { computeOrderTotals, formatUsd, ORDER_PRICING } from "@/lib/order-pricing";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Mail, Globe, Loader2, CheckCircle2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

const TLDS = ["com", "org"];

type Mailbox = { account: string; display_name: string };
type DomainEntry = { name: string; tld: string; mailboxes: Mailbox[] };

const newMailbox = (): Mailbox => ({ account: "", display_name: "" });
const newDomain = (): DomainEntry => ({ name: "", tld: "com", mailboxes: [newMailbox()] });

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "text-amber-600" },
  paid: { label: "Paid", cls: "text-emerald-600" },
  in_progress: { label: "Setting up", cls: "text-sky-600" },
  completed: { label: "Live", cls: "text-emerald-700" },
  canceled: { label: "Canceled", cls: "text-rose-600" },
};

export function OrderAccounts({ showHeader = true }: { showHeader?: boolean }) {
  const [domains, setDomains] = useState<DomainEntry[]>([newDomain()]);
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const checkoutFn = useServerFn(createOrderCheckoutSession);
  const ordersFn = useServerFn(listMyOrders);

  const loadOrders = () => {
    ordersFn()
      .then((r) => setOrders(r.orders))
      .catch(() => {});
  };
  useEffect(() => {
    loadOrders();
    if (new URLSearchParams(window.location.search).get("session_id")) {
      toast.success("Payment received — your accounts are being set up.");
      const t = setTimeout(loadOrders, 4000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domainCount = domains.filter((d) => d.mailboxes.length > 0).length;
  const mailboxCount = domains.reduce((n, d) => n + d.mailboxes.length, 0);
  const totals = useMemo(() => computeOrderTotals(domainCount, mailboxCount), [domainCount, mailboxCount]);
  const dueToday = totals.oneTimeCents + totals.monthlyCents;

  const setDomain = (i: number, patch: Partial<DomainEntry>) =>
    setDomains((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const setMailbox = (di: number, mi: number, patch: Partial<Mailbox>) =>
    setDomains((ds) =>
      ds.map((d, idx) =>
        idx === di
          ? { ...d, mailboxes: d.mailboxes.map((m, j) => (j === mi ? { ...m, ...patch } : m)) }
          : d,
      ),
    );

  const valid =
    terms &&
    mailboxCount > 0 &&
    domains.every(
      (d) => d.name.trim() && d.mailboxes.length > 0 && d.mailboxes.every((m) => m.account.trim()),
    );

  const startCheckout = async () => {
    if (!valid) {
      toast.error("Fill in every domain + mailbox and accept the terms.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await checkoutFn({
        data: {
          config: {
            domains: domains.map((d) => ({
              name: d.name.trim().toLowerCase(),
              tld: d.tld,
              mailboxes: d.mailboxes.map((m) => ({
                account: m.account.trim().toLowerCase(),
                display_name: m.display_name.trim() || undefined,
              })),
            })),
          },
          terms_accepted: true,
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/app/order?session_id={CHECKOUT_SESSION_ID}`,
        },
      });
      if ("error" in r) throw new Error(r.error);
      if (!r.clientSecret) throw new Error("Stripe did not return a checkout.");
      setClientSecret(r.clientSecret);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (clientSecret) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Checkout</h2>
          <Button variant="ghost" size="sm" onClick={() => setClientSecret(null)}>
            ← Back to order
          </Button>
        </div>
        <Card className="p-2">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showHeader && (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Order email accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Done-for-you domains + mailboxes, warmed and ready for cold outreach. We set everything
            up and add it straight to your account.
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your orders
          </div>
          <div className="space-y-2">
            {orders.map((o) => {
              const s = STATUS_LABEL[o.status] ?? { label: o.status, cls: "" };
              return (
                <div key={o.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    {o.domain_count} domain{o.domain_count === 1 ? "" : "s"} · {o.mailbox_count} mailbox
                    {o.mailbox_count === 1 ? "" : "es"}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatUsd(o.monthly_cents)}/mo</span>
                    <Badge variant="outline" className={`text-[10px] ${s.cls}`}>
                      {o.status === "completed" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                      {s.label}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {domains.map((d, di) => (
            <Card key={di} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-primary" /> Domain {di + 1}
                </div>
                {domains.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDomains((ds) => ds.filter((_, idx) => idx !== di))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Preferred domain name</Label>
                  <Input
                    value={d.name}
                    onChange={(e) => setDomain(di, { name: e.target.value })}
                    placeholder="getyourleads"
                  />
                </div>
                <div className="w-28 space-y-1.5">
                  <Label className="text-xs">TLD</Label>
                  <Select value={d.tld} onValueChange={(v) => setDomain(di, { tld: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TLDS.map((t) => (
                        <SelectItem key={t} value={t}>.{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                We confirm exact availability at setup — this is your preferred choice.
              </p>

              <div className="mt-4 space-y-2">
                <Label className="text-xs">Mailboxes on this domain</Label>
                {d.mailboxes.map((m, mi) => (
                  <div key={mi} className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Input
                      value={m.account}
                      onChange={(e) => setMailbox(di, mi, { account: e.target.value })}
                      placeholder="john"
                      className="w-32"
                    />
                    <span className="text-xs text-muted-foreground">@{d.name || "domain"}.{d.tld}</span>
                    <Input
                      value={m.display_name}
                      onChange={(e) => setMailbox(di, mi, { display_name: e.target.value })}
                      placeholder="Display name (e.g. John Smith)"
                      className="flex-1"
                    />
                    {d.mailboxes.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDomain(di, { mailboxes: d.mailboxes.filter((_, j) => j !== mi) })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDomain(di, { mailboxes: [...d.mailboxes, newMailbox()] })}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add mailbox
                </Button>
              </div>
            </Card>
          ))}

          <Button variant="outline" onClick={() => setDomains((ds) => [...ds, newDomain()])}>
            <Plus className="mr-2 h-4 w-4" /> Add another domain
          </Button>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold">Order summary</div>
            <div className="space-y-2 text-sm">
              <Row label={`Domains (${totals.domainCount} × ${formatUsd(ORDER_PRICING.domainCents)})`} value={formatUsd(totals.domainsCents)} />
              <Row label={`Mailboxes (${totals.mailboxCount} × ${formatUsd(ORDER_PRICING.mailboxMonthlyCents)}/mo)`} value={`${formatUsd(totals.monthlyCents)}/mo`} />
              {ORDER_PRICING.setupFeeCents > 0 && (
                <Row label="One-time setup" value={formatUsd(totals.setupCents)} />
              )}
              <div className="my-2 border-t" />
              <Row label="Due today" value={formatUsd(dueToday)} bold />
              <p className="text-[11px] text-muted-foreground">
                Includes domains + setup + first month of mailboxes. Then {formatUsd(totals.monthlyCents)}/month for the mailboxes.
              </p>
            </div>

            <label className="mt-4 flex items-start gap-2 text-xs">
              <Checkbox checked={terms} onCheckedChange={(c) => setTerms(c === true)} className="mt-0.5" />
              <span className="text-muted-foreground">
                I agree to the terms. Domains and mailboxes are managed for me and{" "}
                <strong>stay with the company if I cancel.</strong>
              </span>
            </label>

            <Button className="mt-4 w-full" disabled={!valid || submitting} onClick={startCheckout}>
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting checkout…</>
              ) : (
                <><ShoppingCart className="mr-2 h-4 w-4" /> Continue to payment</>
              )}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
