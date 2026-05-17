import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { enrichLead } from "@/lib/enrich.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ArrowLeft, Sparkles, Loader2, Mail, Linkedin, Phone, Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/lists/$listId")({
  component: ListDetailPage,
  head: () => ({ meta: [{ title: "List — Outreach" }] }),
});

type Row = {
  lead_id: string;
  score: number | null;
  status: string;
  email_subject: string | null;
  email_body: string | null;
  research: {
    reasoning?: string;
    pain_points?: string[];
    talking_points?: string[];
  } | null;
  lead: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
    org_name: string | null;
    org_industry: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
};

function ListDetailPage() {
  const { listId } = Route.useParams();
  const qc = useQueryClient();
  const enrichFn = useServerFn(enrichLead);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Row | null>(null);

  const { data: list } = useQuery({
    queryKey: ["list", listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lists")
        .select("id, name, description")
        .eq("id", listId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: rows, refetch, isLoading } = useQuery({
    queryKey: ["list-leads", listId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("list_leads")
        .select(
          "lead_id, score, status, email_subject, email_body, research, lead:leads(id, first_name, last_name, title, email, phone, linkedin_url, org_name, org_industry, city, state, country)",
        )
        .eq("list_id", listId)
        .order("score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const runOne = async (leadId: string) => {
    setBusy((p) => new Set(p).add(leadId));
    try {
      await enrichFn({ data: { listId, leadId } });
      qc.invalidateQueries({ queryKey: ["list-leads", listId] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to enrich");
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        n.delete(leadId);
        return n;
      });
    }
  };

  const runAll = async () => {
    const pending = (rows ?? []).filter((r) => r.status !== "enriched");
    if (pending.length === 0) {
      toast.info("All leads already researched");
      return;
    }
    toast.info(`Researching ${pending.length} leads…`);
    // Run sequentially to avoid rate-limits
    for (const r of pending) {
      await runOne(r.lead_id);
    }
    toast.success("Done");
  };

  const remove = async (leadId: string) => {
    const { error } = await supabase
      .from("list_leads")
      .delete()
      .eq("list_id", listId)
      .eq("lead_id", leadId);
    if (error) toast.error(error.message);
    else refetch();
  };

  const saveEmail = async (leadId: string, subject: string, body: string) => {
    const { error } = await supabase
      .from("list_leads")
      .update({ email_subject: subject, email_body: body })
      .eq("list_id", listId)
      .eq("lead_id", leadId);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b bg-background px-8 py-5">
        <Link to="/app/lists" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All lists
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{list?.name ?? "Loading…"}</h1>
            {list?.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{list.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {(rows ?? []).length} leads · {(rows ?? []).filter((r) => r.status === "enriched").length} researched
            </p>
          </div>
          <Button onClick={runAll} disabled={!rows || rows.length === 0}>
            <Sparkles className="mr-2 h-4 w-4" /> Research all
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !rows || rows.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No leads in this list yet. Add some from{" "}
              <Link to="/app/people" className="underline">People Search</Link>.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const name =
                [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ") || "—";
              const isBusy = busy.has(r.lead_id);
              return (
                <Card
                  key={r.lead_id}
                  className="flex cursor-pointer items-center gap-4 p-4 transition-shadow hover:shadow-sm"
                  onClick={() => setOpen(r)}
                >
                  <div className="flex w-12 shrink-0 flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                        r.score == null
                          ? "bg-muted text-muted-foreground"
                          : r.score >= 75
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : r.score >= 50
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                      }`}
                    >
                      {r.score ?? "—"}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      {r.status === "enriched" && (
                        <Badge variant="secondary" className="text-[10px]">researched</Badge>
                      )}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {r.lead?.title || "—"}{r.lead?.org_name ? ` · ${r.lead.org_name}` : ""}
                    </div>
                    {r.email_subject && (
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        ✉ {r.email_subject}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant={r.status === "enriched" ? "outline" : "default"}
                      onClick={() => runOne(r.lead_id)}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                          {r.status === "enriched" ? "Re-run" : "Research"}
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r.lead_id)}>
                      Remove
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <LeadDrawer row={open} onClose={() => setOpen(null)} onSave={saveEmail} />
    </div>
  );
}

function LeadDrawer({
  row,
  onClose,
  onSave,
}: {
  row: Row | null;
  onClose: () => void;
  onSave: (leadId: string, subject: string, body: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    setSubject(row?.email_subject ?? "");
    setBody(row?.email_body ?? "");
  }, [row?.lead_id, row?.email_subject, row?.email_body]);

  return (
    <Sheet
      open={!!row}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setSubject("");
          setBody("");
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>
                {[row.lead?.first_name, row.lead?.last_name].filter(Boolean).join(" ") || "Lead"}
              </SheetTitle>
              <SheetDescription>
                {row.lead?.title}{row.lead?.org_name ? ` · ${row.lead.org_name}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6 px-4 pb-8 text-sm">
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {row.lead?.email && (
                  <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${row.lead.email}`}>
                    <Mail className="h-3 w-3" /> {row.lead.email}
                  </a>
                )}
                {row.lead?.phone && (
                  <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {row.lead.phone}</span>
                )}
                {row.lead?.linkedin_url && (
                  <a
                    className="inline-flex items-center gap-1 hover:underline"
                    href={row.lead.linkedin_url.startsWith("http") ? row.lead.linkedin_url : `https://${row.lead.linkedin_url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Linkedin className="h-3 w-3" /> LinkedIn
                  </a>
                )}
              </div>

              {row.score != null && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fit score: {row.score}/100
                  </div>
                  {row.research?.reasoning && (
                    <p className="text-muted-foreground">{row.research.reasoning}</p>
                  )}
                </div>
              )}

              {row.research?.pain_points && row.research.pain_points.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Likely pain points
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {row.research.pain_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {row.research?.talking_points && row.research.talking_points.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Talking points
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {row.research.talking_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(row.email_subject || row.email_body) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Personalized email
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `Subject: ${subject || row.email_subject}\n\n${body || row.email_body}`,
                        );
                        toast.success("Copied");
                      }}
                    >
                      <Copy className="mr-1.5 h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <Input
                    value={subject || row.email_subject || ""}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                  />
                  <Textarea
                    rows={12}
                    value={body || row.email_body || ""}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Email body"
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      onSave(row.lead_id, subject || row.email_subject || "", body || row.email_body || "")
                    }
                  >
                    Save changes
                  </Button>
                </div>
              )}

              {row.status !== "enriched" && (
                <Card className="p-4 text-center text-sm text-muted-foreground">
                  Click <strong>Research</strong> to score this lead and generate a personalized email.
                </Card>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
