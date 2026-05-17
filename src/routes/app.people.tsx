import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Filter,
  MapPin,
  Building2,
  Briefcase,
  X,
  Linkedin,
  Mail,
  Phone,
  Globe,
  Save,
  ListPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { AddToListDialog } from "@/components/AddToListDialog";

export const Route = createFileRoute("/app/people")({
  component: PeoplePage,
  head: () => ({ meta: [{ title: "People Search — Outreach" }] }),
});

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  org_name: string | null;
  org_description: string | null;
  org_website_url: string | null;
  org_industry: string | null;
  org_employee_count: string | null;
};

type Filters = {
  title: string;
  company: string;
  location: string;
  industry: string;
  hasPhone: boolean;
  hasEmail: boolean;
};

const EMPTY: Filters = {
  title: "",
  company: "",
  location: "",
  industry: "",
  hasPhone: false,
  hasEmail: false,
};

const PAGE_SIZE = 25;

function PeoplePage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => setPage(0), [filters]);

  const queryKey = useMemo(() => ["leads", filters, page], [filters, page]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id,first_name,last_name,email,title,linkedin_url,city,state,country,phone,org_name,org_description,org_website_url,org_industry,org_employee_count",
          { count: "exact" },
        );

      if (filters.title.trim()) q = q.ilike("title", `%${filters.title.trim()}%`);
      if (filters.company.trim()) q = q.ilike("org_name", `%${filters.company.trim()}%`);
      if (filters.industry.trim()) q = q.ilike("org_industry", `%${filters.industry.trim()}%`);
      if (filters.location.trim()) {
        const t = filters.location.trim();
        q = q.or(`city.ilike.%${t}%,state.ilike.%${t}%,country.ilike.%${t}%`);
      }
      if (filters.hasPhone) q = q.not("phone", "is", null).neq("phone", "");
      if (filters.hasEmail) q = q.not("email", "is", null).neq("email", "");

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.order("last_name", { ascending: true, nullsFirst: false }).range(from, to);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Lead[], count: count ?? 0 };
    },
  });

  const total = data?.count ?? 0;
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeChips = (Object.keys(filters) as (keyof Filters)[]).filter((k) => {
    const v = filters[k];
    return typeof v === "string" ? v.trim() !== "" : v === true;
  });

  const apply = () => setFilters(draft);
  const clear = () => {
    setDraft(EMPTY);
    setFilters(EMPTY);
  };

  const saveSearch = async () => {
    const name = window.prompt("Name this saved search");
    if (!name) return;
    const { data: session } = await supabase.auth.getUser();
    if (!session.user) return;
    const { error } = await supabase.from("saved_searches").insert({
      user_id: session.user.id,
      name,
      filters: filters as any,
    });
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-background px-8 py-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People Search</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} contacts in your database
          </p>
        </div>
        <div className="flex items-center gap-2">
          {picked.size > 0 && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <ListPlus className="mr-2 h-4 w-4" /> Add {picked.size} to list
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={saveSearch}>
            <Save className="mr-2 h-4 w-4" /> Save search
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 shrink-0 overflow-y-auto border-r bg-background p-5">
          <div className="mb-4 flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <span className="text-sm font-medium">Filters</span>
            {activeChips.length > 0 && (
              <button
                onClick={clear}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-5">
            <Field
              icon={<Briefcase className="h-3.5 w-3.5" />}
              label="Job title"
              placeholder="e.g. VP of Sales"
              value={draft.title}
              onChange={(v) => setDraft({ ...draft, title: v })}
            />
            <Field
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Company"
              placeholder="e.g. Acme Corp"
              value={draft.company}
              onChange={(v) => setDraft({ ...draft, company: v })}
            />
            <Field
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Location"
              placeholder="city, state or country"
              value={draft.location}
              onChange={(v) => setDraft({ ...draft, location: v })}
            />
            <Field
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Industry"
              placeholder="e.g. Software"
              value={draft.industry}
              onChange={(v) => setDraft({ ...draft, industry: v })}
            />

            <div className="space-y-2 pt-2">
              <Toggle
                label="Has phone number"
                checked={draft.hasPhone}
                onChange={(v) => setDraft({ ...draft, hasPhone: v })}
              />
              <Toggle
                label="Has email"
                checked={draft.hasEmail}
                onChange={(v) => setDraft({ ...draft, hasEmail: v })}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={apply}>
                <Search className="mr-2 h-4 w-4" /> Apply
              </Button>
            </div>
          </div>
        </aside>

        <section className="flex-1 overflow-y-auto">
          {activeChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
              {activeChips.map((k) => (
                <Badge key={k} variant="secondary" className="gap-1">
                  {k}: {String(filters[k])}
                  <button
                    onClick={() => {
                      const next = { ...filters, [k]: typeof filters[k] === "boolean" ? false : "" } as Filters;
                      setFilters(next);
                      setDraft(next);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="p-6">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={rows.length > 0 && rows.every((r) => picked.has(r.id))}
                        onCheckedChange={(v) => {
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (v) rows.forEach((r) => next.add(r.id));
                            else rows.forEach((r) => next.delete(r.id));
                            return next;
                          });
                        }}
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Contact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                        No leads match your filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(r)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={picked.has(r.id)}
                            onCheckedChange={(v) => {
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-sm">
                          {r.title || "—"}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">
                          {r.org_name || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {[r.city, r.state].filter(Boolean).join(", ") || r.country || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1.5 text-muted-foreground">
                            {r.email && <Mail className="h-3.5 w-3.5" />}
                            {r.phone && <Phone className="h-3.5 w-3.5" />}
                            {r.linkedin_url && <Linkedin className="h-3.5 w-3.5" />}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {isFetching ? "Loading…" : `Page ${page + 1} of ${totalPages.toLocaleString()}`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <AddToListDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        leadIds={Array.from(picked)}
        onAdded={() => setPicked(new Set())}
      />

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {[selected.first_name, selected.last_name].filter(Boolean).join(" ") || "Lead"}
                </SheetTitle>
                <SheetDescription>{selected.title}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 px-4 pb-6 text-sm">
                <Section title="Company">
                  <div className="font-medium">{selected.org_name || "—"}</div>
                  {selected.org_industry && (
                    <div className="text-muted-foreground">{selected.org_industry}</div>
                  )}
                  {selected.org_employee_count && (
                    <div className="text-muted-foreground">{selected.org_employee_count} employees</div>
                  )}
                  {selected.org_description && (
                    <p className="mt-2 line-clamp-6 whitespace-pre-line text-muted-foreground">
                      {selected.org_description}
                    </p>
                  )}
                </Section>
                <Section title="Location">
                  {[selected.city, selected.state, selected.country].filter(Boolean).join(", ") || "—"}
                </Section>
                <Section title="Contact">
                  <div className="space-y-1.5">
                    {selected.email && (
                      <Row icon={<Mail className="h-3.5 w-3.5" />} value={selected.email} href={`mailto:${selected.email}`} />
                    )}
                    {selected.phone && (
                      <Row icon={<Phone className="h-3.5 w-3.5" />} value={selected.phone} href={`tel:${selected.phone}`} />
                    )}
                    {selected.linkedin_url && (
                      <Row
                        icon={<Linkedin className="h-3.5 w-3.5" />}
                        value="LinkedIn profile"
                        href={selected.linkedin_url.startsWith("http") ? selected.linkedin_url : `https://${selected.linkedin_url}`}
                      />
                    )}
                    {selected.org_website_url && (
                      <Row
                        icon={<Globe className="h-3.5 w-3.5" />}
                        value={selected.org_website_url}
                        href={selected.org_website_url.startsWith("http") ? selected.org_website_url : `https://${selected.org_website_url}`}
                      />
                    )}
                  </div>
                </Section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({
  icon, label, placeholder, value, onChange,
}: { icon: React.ReactNode; label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ icon, value, href }: { icon: React.ReactNode; value: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-foreground hover:underline"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </a>
  );
}
