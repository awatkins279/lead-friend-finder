import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Bookmark } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/saved")({
  component: SavedPage,
  head: () => ({ meta: [{ title: "Saved Searches — Outreach" }] }),
});

function SavedPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["saved_searches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_searches")
        .select("id,name,filters,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const remove = async (id: string) => {
    const { error } = await supabase.from("saved_searches").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["saved_searches"] });
    }
  };

  return (
    <div className="p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Saved Searches</h1>
      <p className="mb-6 text-sm text-muted-foreground">Re-use your favorite filter sets.</p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <Bookmark className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No saved searches yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Apply filters on People Search and click “Save search”.
          </p>
          <Button className="mt-4" size="sm" onClick={() => nav({ to: "/app/people" })}>
            Go to People Search
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.map((s) => {
            const f = s.filters as Record<string, unknown>;
            const chips = Object.entries(f)
              .filter(([, v]) => (typeof v === "string" ? v.trim() : v))
              .map(([k, v]) => `${k}: ${v}`);
            return (
              <Card key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {chips.length === 0 ? "No filters" : chips.join(" · ")}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
