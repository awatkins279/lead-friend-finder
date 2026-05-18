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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.map((l) => (
              <Card key={l.id} className="group relative flex flex-col gap-3 p-5 transition-shadow hover:shadow-md">
                <button
                  onClick={() => remove(l.id)}
                  className="absolute right-3 top-3 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete list"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Link to="/app/lists/$listId" params={{ listId: l.id }} className="flex flex-col gap-2">
                  <h3 className="pr-6 text-base font-semibold">{l.name}</h3>
                  {l.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {l.count} {l.count === 1 ? "lead" : "leads"}
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
