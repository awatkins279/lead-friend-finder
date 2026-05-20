import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { List as ListIcon, Plus, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/lists/")({
  component: ListsPage,
  head: () => ({ meta: [{ title: "Lists — NexusAi" }] }),
});

function ListsPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["lists"],
    queryFn: async () => {
      const { data: lists, error } = await supabase
        .from("lists")
        .select("id, name, description, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (lists ?? []).map((l) => l.id);
      let counts: Record<string, number> = {};
      if (ids.length) {
        const { data: rows } = await supabase
          .from("list_leads")
          .select("list_id")
          .in("list_id", ids);
        (rows ?? []).forEach((r: any) => {
          counts[r.list_id] = (counts[r.list_id] ?? 0) + 1;
        });
      }
      return (lists ?? []).map((l) => ({ ...l, count: counts[l.id] ?? 0 }));
    },
  });

  const create = async () => {
    if (!name.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("lists").insert({
      user_id: u.user.id,
      name: name.trim(),
      description: desc.trim() || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("List created");
      setOpen(false);
      setName("");
      setDesc("");
      refetch();
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this list and all its leads?")) return;
    const { error } = await supabase.from("lists").delete().eq("id", id);
    if (error) toast.error(error.message);
    else refetch();
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-background px-8 py-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lists</h1>
          <p className="text-sm text-muted-foreground">
            Group prospects, research them, and draft personalized emails.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" /> New list
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New list</DialogTitle>
              <DialogDescription>
                Describe what you're selling so the AI can personalize emails.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SaaS CTOs" />
              </div>
              <div>
                <Label className="text-xs">Description (campaign context)</Label>
                <Input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="What are you selling and to whom?"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center">
            <ListIcon className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">No lists yet</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Head to <Link to="/app/people" className="underline">People Search</Link>, select leads, and add them to a list.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {data.map((l) => (
              <Card
                key={l.id}
                className="group relative flex min-h-[260px] flex-col gap-4 overflow-hidden border-border/60 bg-gradient-to-br from-card to-card/60 p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl"
              >
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 opacity-60 blur-3xl" />
                <button
                  onClick={() => remove(l.id)}
                  className="absolute right-4 top-4 z-10 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete list"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Link
                  to="/app/lists/$listId"
                  params={{ listId: l.id }}
                  className="relative flex flex-1 flex-col gap-3"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                    <ListIcon className="h-6 w-6" />
                  </div>
                  <h3 className="pr-8 text-2xl font-semibold leading-tight tracking-tight">
                    {l.name}
                  </h3>
                  <div className="mt-auto flex items-center gap-2 pt-3 text-sm font-medium text-foreground/70">
                    <Users className="h-4 w-4" />
                    {l.count.toLocaleString()} {l.count === 1 ? "lead" : "leads"}
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
