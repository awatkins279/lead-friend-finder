import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
  head: () => ({ meta: [{ title: "Sending accounts — Forge AI" }] }),
});

function AccountsPage() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sending accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect Gmail / Workspace inboxes to send campaigns from. Coming soon.
          </p>
        </div>
        <Button disabled>
          <Plus className="mr-2 h-4 w-4" /> Add account
        </Button>
      </div>

      <Card className="p-12 text-center">
        <Mail className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No sending accounts yet</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          When ready, buy a domain through the app and connect Gmail / Workspace inboxes here.
          Each inbox gets warmed up, SPF / DKIM / DMARC monitored, and can be rotated across
          campaigns to protect deliverability.
        </p>
      </Card>
    </div>
  );
}
