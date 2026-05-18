import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Linkedin, Bookmark, LogOut, List as ListIcon, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import forgeLogo from "@/assets/forgeai-logo.svg";

export const Route = createFileRoute("/app")({
  component: AppShell,
});

function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) nav({ to: "/login" });
      else setEmail(session.user.email ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) nav({ to: "/login" });
      else {
        setEmail(data.session.user.email ?? null);
        setReady(true);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  const nav_items = [
    { to: "/app/people", icon: Users, label: "People Search" },
    { to: "/app/lists", icon: ListIcon, label: "Campaigns" },
    { to: "/app/saved", icon: Bookmark, label: "Saved Searches" },
    { to: "/app/accounts", icon: Inbox, label: "Sending Accounts" },
    { to: "/app/linkedin", icon: Linkedin, label: "LinkedIn (soon)", disabled: true },
  ];

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="flex w-60 flex-col border-r bg-background">
        <div className="px-4 py-4">
          <img src={forgeLogo} alt="Forge AI" className="h-10 w-auto" />
        </div>
        <nav className="flex-1 px-3">
          {nav_items.map((item) => {
            const active = loc.pathname.startsWith(item.to);
            const Icon = item.icon;
            const cls = `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : item.disabled
                  ? "text-muted-foreground/60 cursor-not-allowed"
                  : "text-foreground hover:bg-accent"
            }`;
            if (item.disabled) {
              return (
                <div key={item.to} className={cls}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </div>
              );
            }
            return (
              <Link key={item.to} to={item.to} className={cls}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3 text-xs">
          <div className="mb-2 truncate px-2 text-muted-foreground">{email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={async () => {
              await supabase.auth.signOut();
              nav({ to: "/login" });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
