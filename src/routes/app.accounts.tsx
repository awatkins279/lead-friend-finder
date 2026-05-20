import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  Phone,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { PhoneAccountDialog, type PhoneAccountRow } from "@/components/PhoneAccountDialog";
import { ProviderAccountDialog, PROVIDER_SPECS } from "@/components/ProviderAccountDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
  head: () => ({ meta: [{ title: "Sending accounts — NexusAi" }] }),
});

const PLACEHOLDER = "+10000000000";

type PhoneProvider = {
  id: string;
  name: string;
  description: string;
  available: boolean;
};

const PHONE_PROVIDERS: PhoneProvider[] = [
  { id: "twilio", name: "Twilio", description: "Programmable Voice — most popular, pay-as-you-go.", available: true },
  { id: "ringcentral", name: "RingCentral", description: "Business phone system with RingOut API.", available: true },
  { id: "vonage", name: "Vonage", description: "Voice API (formerly Nexmo).", available: false },
  { id: "plivo", name: "Plivo", description: "Twilio alternative, cheaper international rates.", available: false },
  { id: "telnyx", name: "Telnyx", description: "Carrier-grade voice API.", available: false },
  { id: "bandwidth", name: "Bandwidth", description: "Enterprise voice + messaging.", available: false },
];

function AccountsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PhoneAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PhoneAccountRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const pickProvider = (p: PhoneProvider) => {
    if (!p.available) {
      toast.info(`${p.name} support is coming soon.`);
      return;
    }
    setPickerOpen(false);
    setEditing(null);
    if (p.id === "twilio") {
      setOpen(true);
    } else {
      setProviderOpen(p.id);
    }
  };

  const openEdit = (a: PhoneAccountRow) => {
    setEditing(a);
    const prov = (a as unknown as { provider?: string }).provider ?? "twilio";
    if (prov === "twilio") setOpen(true);
    else setProviderOpen(prov);
  };

  const accountCount = accounts.length;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sending accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the phone and email accounts your campaigns will send from.
        </p>
      </div>

      <Tabs defaultValue="phone" className="space-y-6">
        <TabsList>
          <TabsTrigger value="phone" className="gap-2">
            <Phone className="h-3.5 w-3.5" /> Phone accounts
            {accountCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{accountCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-3.5 w-3.5" /> Email accounts
          </TabsTrigger>
        </TabsList>

        {/* PHONE TAB */}
        <TabsContent value="phone" className="space-y-4">
          <div className="flex items-start justify-between">
            <p className="text-sm text-muted-foreground">
              Connect a calling provider. Pick from supported providers below.
            </p>
            <Button onClick={() => setPickerOpen(true)} disabled={!userId}>
              <Plus className="mr-2 h-4 w-4" /> Add phone account
            </Button>
          </div>

          {loading ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
          ) : accounts.length === 0 ? (
            <Card className="p-12 text-center">
              <Phone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No phone accounts yet</p>
              <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
                Click <strong>Add phone account</strong> to choose a provider and connect it.
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
                        <Badge variant="outline" className="text-[10px]">Twilio</Badge>
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
        </TabsContent>

        {/* EMAIL TAB */}
        <TabsContent value="email" className="space-y-4">
          <div className="flex items-start justify-between">
            <p className="text-sm text-muted-foreground">
              Connect Google accounts to send campaign emails from your own inbox.
            </p>
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" /> Connect Google account
            </Button>
          </div>

          <Card className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium">Email sending — coming soon</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
              Google account connection is being wired up. Once enabled, you'll be able to
              link multiple Gmail / Google Workspace inboxes here and rotate sends across them
              in your campaigns.
            </p>
            <div className="mx-auto mt-5 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Notify me when ready
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Provider picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a phone provider</DialogTitle>
            <DialogDescription>
              Pick the service you use for outbound calls. More providers are being added.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2">
            {PHONE_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickProvider(p)}
                className={`group relative rounded-lg border p-4 text-left transition-all ${
                  p.available
                    ? "hover:border-primary/50 hover:bg-accent cursor-pointer"
                    : "opacity-60 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  {p.available ? (
                    <Badge variant="secondary" className="text-[10px]">Available</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

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
