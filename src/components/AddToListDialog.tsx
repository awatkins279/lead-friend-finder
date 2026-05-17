import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";

type List = { id: string; name: string };

export function AddToListDialog({
  open,
  onOpenChange,
  leadIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  onAdded?: () => void;
}) {
  const [lists, setLists] = useState<List[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("lists")
      .select("id, name")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setLists((data ?? []) as List[]);
        if (data && data.length > 0) setSelectedId((data[0] as List).id);
        else setSelectedId("");
      });
  }, [open]);

  const submit = async () => {
    if (leadIds.length === 0) return;
    setBusy(true);
    try {
      let listId = selectedId;
      if (!listId) {
        if (!newName.trim()) {
          toast.error("Pick a list or name a new one");
          return;
        }
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data: created, error } = await supabase
          .from("lists")
          .insert({ user_id: u.user.id, name: newName.trim(), description: newDesc.trim() || null })
          .select("id")
          .single();
        if (error) throw error;
        listId = created.id;
      }

      const rows = leadIds.map((id) => ({ list_id: listId, lead_id: id }));
      const { error: insErr } = await supabase
        .from("list_leads")
        .upsert(rows, { onConflict: "list_id,lead_id", ignoreDuplicates: true });
      if (insErr) throw insErr;

      toast.success(`Added ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} to list`);
      onAdded?.();
      onOpenChange(false);
      setNewName("");
      setNewDesc("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} to a list</DialogTitle>
          <DialogDescription>
            Group these prospects so you can research them and draft personalized emails.
          </DialogDescription>
        </DialogHeader>

        {lists.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Existing lists</Label>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
              {lists.map((l) => (
                <label
                  key={l.id}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent ${selectedId === l.id ? "bg-accent" : ""}`}
                >
                  <input
                    type="radio"
                    checked={selectedId === l.id}
                    onChange={() => setSelectedId(l.id)}
                  />
                  {l.name}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                <input
                  type="radio"
                  checked={selectedId === ""}
                  onChange={() => setSelectedId("")}
                />
                <Plus className="h-3.5 w-3.5" /> Create new list
              </label>
            </div>
          </div>
        )}

        {selectedId === "" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">New list name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. NYC SaaS founders" />
            </div>
            <div>
              <Label className="text-xs">Description (used by AI for personalization)</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What are you selling and to whom?"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
