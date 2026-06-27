import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Package, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getProductInfo, saveProductInfo, type ProductInfo } from "@/lib/product-info.functions";

export const Route = createFileRoute("/app/product-info")({
  component: ProductInfoPage,
});

const EMPTY: ProductInfo = {
  company_name: "",
  product_name: "",
  product_description: "",
  product_value_props: "",
  ideal_customer: "",
  common_objections: "",
  proof_points: "",
  pricing_notes: "",
  competitors: "",
  call_to_action: "",
};

function ProductInfoPage() {
  const fetchInfo = useServerFn(getProductInfo);
  const saveInfo = useServerFn(saveProductInfo);
  const { data, isLoading } = useQuery({ queryKey: ["product-info"], queryFn: () => fetchInfo() });
  const [form, setForm] = useState<ProductInfo>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.info) {
      const next = { ...EMPTY };
      for (const k of Object.keys(EMPTY) as (keyof ProductInfo)[]) {
        (next as any)[k] = (data.info[k] ?? "") as string;
      }
      setForm(next);
    }
  }, [data]);

  const upd = <K extends keyof ProductInfo>(k: K, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await saveInfo({ data: form as any });
      toast.success("Product info saved — the AI co-pilot will use this on every call");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[oklch(0.50_0.22_295)] to-[oklch(0.62_0.20_265)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] text-white">
            <Sparkles className="h-3 w-3" /> AI Co-pilot Brain
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Package className="h-6 w-6 text-primary" /> Product Info
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tell the AI everything it needs to know about what you sell. This is the base context
            used during every live call, so the teleprompter knows what to tell the rep — even for
            objections and questions you didn't script.
          </p>
        </div>
        <Button onClick={save} disabled={saving || isLoading} className="shrink-0">
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Button>
      </header>

      <div className="grid gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Company name" hint="Your company.">
            <Input
              value={form.company_name ?? ""}
              onChange={(e) => upd("company_name", e.target.value)}
              placeholder="Acme Inc."
            />
          </Field>
          <Field label="Product / service name">
            <Input
              value={form.product_name ?? ""}
              onChange={(e) => upd("product_name", e.target.value)}
              placeholder="Acme Sales OS"
            />
          </Field>
        </div>

        <Field
          label="What it is + what it does"
          hint="Plain English. Imagine explaining to a smart friend in 30 seconds."
        >
          <Textarea
            rows={4}
            value={form.product_description ?? ""}
            onChange={(e) => upd("product_description", e.target.value)}
            placeholder="We're an AI-powered cold-calling platform that gives reps a live teleprompter on every call…"
          />
        </Field>

        <Field
          label="Value props / why it matters"
          hint="Top 3-5 outcomes a buyer cares about. The AI will pick the right one based on what the prospect just said."
        >
          <Textarea
            rows={4}
            value={form.product_value_props ?? ""}
            onChange={(e) => upd("product_value_props", e.target.value)}
            placeholder="• Reps book 3x more meetings in week 1\n• No more freezing on objections\n• Onboarding new reps in days, not months"
          />
        </Field>

        <Field label="Ideal customer" hint="Who this is FOR. Helps the AI tailor on the fly.">
          <Textarea
            rows={3}
            value={form.ideal_customer ?? ""}
            onChange={(e) => upd("ideal_customer", e.target.value)}
            placeholder="B2B SaaS sales leaders with 5-50 SDRs running outbound."
          />
        </Field>

        <Field
          label="Common objections + how to handle them"
          hint="The AI uses these verbatim when the prospect raises something similar."
        >
          <Textarea
            rows={5}
            value={form.common_objections ?? ""}
            onChange={(e) => upd("common_objections", e.target.value)}
            placeholder={`"Send me an email" → "Happy to — what would you actually want me to send so it's useful?"\n"We already have something" → "Got it, what's working well and what isn't?"`}
          />
        </Field>

        <Field label="Proof / social proof" hint="Stats, logos, case studies the rep can drop in.">
          <Textarea
            rows={3}
            value={form.proof_points ?? ""}
            onChange={(e) => upd("proof_points", e.target.value)}
            placeholder="• 200+ teams using us\n• Avg rep: +42% answer rate\n• Logos: Acme, Globex, Initech"
          />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Pricing notes" hint="How to talk about price without giving away too much.">
            <Textarea
              rows={4}
              value={form.pricing_notes ?? ""}
              onChange={(e) => upd("pricing_notes", e.target.value)}
              placeholder="Starts at $X/seat/mo. Don't quote on first call — book a demo."
            />
          </Field>
          <Field label="Main competitors" hint="So the AI knows the differentiator angle.">
            <Textarea
              rows={4}
              value={form.competitors ?? ""}
              onChange={(e) => upd("competitors", e.target.value)}
              placeholder="Outreach, SalesLoft — we differ because…"
            />
          </Field>
        </div>

        <Field
          label="Default call-to-action"
          hint="The thing the rep is trying to close on every call."
        >
          <Input
            value={form.call_to_action ?? ""}
            onChange={(e) => upd("call_to_action", e.target.value)}
            placeholder="Book a 15-min discovery call this week."
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || isLoading} size="lg">
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save product info"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
