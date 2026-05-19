import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Phone, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { PhoneAccountDialog, type PhoneAccountRow } from "@/components/PhoneAccountDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
  head: () => ({ meta: [{ title: "Sending accounts — NexusAi" }] }),
});

const PLACEHOLDER = "+10000000000";

function AccountsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PhoneAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PhoneAccountRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    setUserId(uid);
    if (!uid) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("user_phone_accounts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setAccounts((data ?? []) as PhoneAccountRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!confirm("Delete this phone account?")) return;
    const { error } = await supabase.from("user_phone_accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Phone accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Twilio sub-account. You can save credentials now and add the phone
            number later once your Twilio account is verified.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          disabled={!userId}
        >
          <Plus className="mr-2 h-4 w-4" /> Add Twilio account
        </Button>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : accounts.length === 0 ? (
        <Card className="p-12 text-center">
          <Phone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No phone accounts yet</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            Click <strong>Add Twilio account</strong> to save your credentials. You'll be able to
            generate AI call scripts immediately — placing real calls just needs a Twilio phone
            number, which you can add here later.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const needsNumber = !a.from_number || a.from_number === PLACEHOLDER;
            const needsTwiml = !a.twilio_twiml_app_sid;
            const ready = !needsNumber && !needsTwiml;
            return (
              <Card key={a.id} className="flex items-center justify-between p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    <span className="font-medium">{a.label}</span>
                    {ready ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3" /> Setup incomplete
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    From: {needsNumber ? <em>not set yet</em> : a.from_number}
                    {" · "}TwiML App: {needsTwiml ? <em>not set</em> : a.twilio_twiml_app_sid}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {a.twilio_account_sid}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(a);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(a.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {userId && (
        <PhoneAccountDialog
          userId={userId}
          open={open}
          onOpenChange={setOpen}
          onSaved={load}
          existing={editing}
        />
      )}
    </div>
  );
}
