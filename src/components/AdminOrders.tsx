import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listAdminOrders,
  updateOrderStatus,
  saveOrderFulfillment,
  pushOrderToInstantly,
  assignOrderToCustomer,
  type AdminOrder,
} from "@/lib/admin-orders.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronUp, Zap, UserCheck, Save } from "lucide-react";
import { toast } from "sonner";

type MailboxFulfill = {
  email: string;
  display_name: string;
  provider_code: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  imap_host: string;
  imap_port: string;
  imap_username: string;
  imap_password: string;
};

function seedMailboxes(o: AdminOrder): MailboxFulfill[] {
  // Prefer already-saved fulfillment; else seed from the requested config.
  const saved = (o.fulfillment?.mailboxes ?? []) as any[];
  if (saved.length) {
    return saved.map((m) => ({
      email: m.email ?? "",
      display_name: m.display_name ?? "",
      provider_code: m.provider_code != null ? String(m.provider_code) : "",
      smtp_host: m.smtp_host ?? "",
      smtp_port: m.smtp_port != null ? String(m.smtp_port) : "587",
      smtp_username: m.smtp_username ?? "",
      smtp_password: m.smtp_password ?? "",
      imap_host: m.imap_host ?? "",
      imap_port: m.imap_port != null ? String(m.imap_port) : "993",
      imap_username: m.imap_username ?? "",
      imap_password: m.imap_password ?? "",
    }));
  }
  const domains = (o.config?.domains ?? []) as any[];
  const out: MailboxFulfill[] = [];
  for (const d of domains) {
    for (const m of d.mailboxes ?? []) {
      const email = `${m.account}@${d.name}.${d.tld}`;
      out.push({
        email,
        display_name: m.display_name ?? "",
        provider_code: "",
        smtp_host: "",
        smtp_port: "587",
        smtp_username: email,
        smtp_password: "",
        imap_host: "",
        imap_port: "993",
        imap_username: email,
        imap_password: "",
      });
    }
  }
  return out;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting payment", cls: "text-amber-600" },
  paid: { label: "Paid — to fulfill", cls: "text-emerald-600" },
  in_progress: { label: "In progress", cls: "text-sky-600" },
  completed: { label: "Completed", cls: "text-emerald-700" },
  canceled: { label: "Canceled", cls: "text-rose-600" },
};

export function AdminOrders() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<MailboxFulfill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const listFn = useServerFn(listAdminOrders);
  const statusFn = useServerFn(updateOrderStatus);
  const saveFn = useServerFn(saveOrderFulfillment);
  const pushFn = useServerFn(pushOrderToInstantly);
  const assignFn = useServerFn(assignOrderToCustomer);

  const load = () =>
    listFn()
      .then((r) => setOrders(r.orders))
      .catch((e) => toast.error((e as Error).message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFulfill = (o: AdminOrder) => {
    if (expanded === o.id) {
      setExpanded(null);
      return;
    }
    setExpanded(o.id);
    setForm(seedMailboxes(o));
  };

  const setMb = (i: number, patch: Partial<MailboxFulfill>) =>
    setForm((f) => f.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const setStatus = async (orderId: string, status: "in_progress" | "paid" | "canceled") => {
    setBusy(orderId);
    try {
      await statusFn({ data: { orderId, status } });
      toast.success("Status updated");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toPayload = () =>
    form.map((m) => ({
      email: m.email.trim().toLowerCase(),
      display_name: m.display_name.trim(),
      provider_code: m.provider_code.trim() || undefined,
      smtp_host: m.smtp_host.trim(),
      smtp_port: Number(m.smtp_port) || 587,
      smtp_username: m.smtp_username.trim(),
      smtp_password: m.smtp_password,
      imap_host: m.imap_host.trim(),
      imap_port: Number(m.imap_port) || 993,
      imap_username: m.imap_username.trim(),
      imap_password: m.imap_password,
    }));

  const save = async (orderId: string) => {
    setBusy(orderId);
    try {
      await saveFn({ data: { orderId, fulfillment: { mailboxes: toPayload() } } });
      toast.success("Fulfillment saved");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const push = async (orderId: string) => {
    setBusy(orderId);
    try {
      await saveFn({ data: { orderId, fulfillment: { mailboxes: toPayload() } } });
      const r = await pushFn({ data: { orderId } });
      if (r.ok) toast.success("All mailboxes added to Instantly + warming up");
      else
        toast.error(
          `Some failed: ${r.results
            .filter((x) => !x.ok)
            .map((x) => `${x.email} (${x.error})`)
            .join("; ")}`,
        );
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const assign = async (orderId: string) => {
    setBusy(orderId);
    try {
      await saveFn({ data: { orderId, fulfillment: { mailboxes: toPayload() } } });
      const r = await assignFn({ data: { orderId } });
      toast.success(`Assigned ${r.assigned} mailbox(es) to the customer — order completed`);
      setExpanded(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!orders) return <Card className="p-6 text-sm text-muted-foreground">Loading orders…</Card>;
  if (orders.length === 0)
    return <Card className="p-6 text-sm text-muted-foreground">No orders yet.</Card>;

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const s = STATUS[o.status] ?? { label: o.status, cls: "" };
        const isOpen = expanded === o.id;
        const requested = (o.config?.domains ?? []) as any[];
        return (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{o.customer_email ?? o.user_id.slice(0, 8)}</span>
                  <Badge variant="outline" className={`text-[10px] ${s.cls}`}>
                    {s.label}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {o.domain_count} domain(s) · {o.mailbox_count} mailbox(es) ·{" "}
                  {new Date(o.created_at).toLocaleDateString()}
                  {o.paid_at && ` · paid ${new Date(o.paid_at).toLocaleDateString()}`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Requested:{" "}
                  {requested
                    .map(
                      (d) =>
                        `${d.mailboxes?.map((m: any) => m.account).join(", ")}@${d.name}.${d.tld}`,
                    )
                    .join("  ·  ")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {o.status === "paid" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === o.id}
                    onClick={() => setStatus(o.id, "in_progress")}
                  >
                    Start
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={isOpen ? "secondary" : "default"}
                  onClick={() => openFulfill(o)}
                >
                  Fulfill{" "}
                  {isOpen ? (
                    <ChevronUp className="ml-1 h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {isOpen && (
              <div className="mt-4 space-y-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Enter the <strong>real</strong> mailbox + SMTP/IMAP credentials you created, then
                  push them to Instantly and assign to the customer. (Passwords are stored on the
                  order only, never shown to the customer.)
                </p>
                {form.map((m, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Field label="Email">
                        <Input
                          value={m.email}
                          onChange={(e) => setMb(i, { email: e.target.value })}
                        />
                      </Field>
                      <Field label="Display name">
                        <Input
                          value={m.display_name}
                          onChange={(e) => setMb(i, { display_name: e.target.value })}
                        />
                      </Field>
                      <Field label="Provider code">
                        <Input
                          value={m.provider_code}
                          onChange={(e) => setMb(i, { provider_code: e.target.value })}
                          placeholder="from Instantly"
                        />
                      </Field>
                      <div />
                      <Field label="SMTP host">
                        <Input
                          value={m.smtp_host}
                          onChange={(e) => setMb(i, { smtp_host: e.target.value })}
                          placeholder="smtp.provider.com"
                        />
                      </Field>
                      <Field label="SMTP port">
                        <Input
                          value={m.smtp_port}
                          onChange={(e) => setMb(i, { smtp_port: e.target.value })}
                        />
                      </Field>
                      <Field label="SMTP username">
                        <Input
                          value={m.smtp_username}
                          onChange={(e) => setMb(i, { smtp_username: e.target.value })}
                        />
                      </Field>
                      <Field label="SMTP password">
                        <Input
                          type="password"
                          value={m.smtp_password}
                          onChange={(e) => setMb(i, { smtp_password: e.target.value })}
                        />
                      </Field>
                      <Field label="IMAP host">
                        <Input
                          value={m.imap_host}
                          onChange={(e) => setMb(i, { imap_host: e.target.value })}
                          placeholder="imap.provider.com"
                        />
                      </Field>
                      <Field label="IMAP port">
                        <Input
                          value={m.imap_port}
                          onChange={(e) => setMb(i, { imap_port: e.target.value })}
                        />
                      </Field>
                      <Field label="IMAP username">
                        <Input
                          value={m.imap_username}
                          onChange={(e) => setMb(i, { imap_username: e.target.value })}
                        />
                      </Field>
                      <Field label="IMAP password">
                        <Input
                          type="password"
                          value={m.imap_password}
                          onChange={(e) => setMb(i, { imap_password: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === o.id}
                    onClick={() => save(o.id)}
                  >
                    {busy === o.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                    )}{" "}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === o.id}
                    onClick={() => push(o.id)}
                  >
                    <Zap className="mr-1.5 h-3.5 w-3.5" /> Push to Instantly
                  </Button>
                  <Button size="sm" disabled={busy === o.id} onClick={() => assign(o.id)}>
                    <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Assign to customer + complete
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
