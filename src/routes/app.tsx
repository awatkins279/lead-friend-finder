import { createFileRoute, Outlet, useNavigate, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Linkedin,
  Bookmark,
  LogOut,
  Send,
  Inbox,
  Bot,
  Mail,
  Voicemail,
  Sparkles,
  ChevronDown,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { CreditWidget } from "@/components/CreditWidget";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/app")({
  component: AppShell,
});

function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const fetchIsAdmin = useServerFn(checkIsAdmin);

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
        fetchIsAdmin()
          .then((r) => setIsAdmin(r.isAdmin))
          .catch(() => setIsAdmin(false));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [nav, fetchIsAdmin]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const nav_items = [
    { to: "/app/people", icon: Users, label: "People Search" },
    { to: "/app/lists", icon: Send, label: "Campaigns" },
    { to: "/app/inbox", icon: Inbox, label: "Inbox" },
    { to: "/app/saved", icon: Bookmark, label: "Saved Searches" },
    { to: "/app/accounts", icon: Mail, label: "Sending Accounts" },
    { to: "/app/sdr-agents", icon: Bot, label: "AI SDR Agents" },
    { to: "/app/voicemail-agent", icon: Voicemail, label: "AI Voicemail Agent" },
    { to: "/app/linkedin", icon: Linkedin, label: "LinkedIn (soon)", disabled: true },
    ...(isAdmin ? [{ to: "/app/admin", icon: Shield, label: "Admin" }] : []),
  ];

  const initials = (email ?? "U")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  // Derive company name from email domain (e.g. "user@ttmusa.net" → "TTMUSA")
  const companyName = (() => {
    const domain = email?.split("@")[1];
    if (!domain) return "My Company";
    const core = domain.split(".")[0];
    return core.toUpperCase();
  })();

  return (
    <div className="dashboard-font flex min-h-screen w-full gap-4 p-4">
      {/* Sidebar */}
      <aside className="glass-panel-strong sticky top-4 flex h-[calc(100vh-2rem)] w-64 flex-col rounded-2xl p-4">
        {/* Logo */}
        <div className="mb-6 flex items-center gap-3 px-2 pt-1">
          <div className="ring-glow grid h-10 w-10 place-items-center rounded-xl bg-[var(--gradient-aurora)] shadow-lg">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-base font-semibold tracking-tight">NexusAi</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
          {nav_items.map((item) => {
            const active = loc.pathname.startsWith(item.to);
            const Icon = item.icon;
            const base =
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all";
            const cls = active
              ? `${base} glass-panel font-medium text-foreground`
              : item.disabled
                ? `${base} text-muted-foreground/50 cursor-not-allowed`
                : `${base} text-muted-foreground hover:bg-white/5 hover:text-foreground`;

            const inner = (
              <>
                <span
                  className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
                    active
                      ? "bg-[var(--gradient-aurora-soft)] text-foreground"
                      : "bg-white/[0.03] text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate">{item.label}</span>
                {active && (
                  <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[oklch(0.78_0.16_210)] shadow-[0_0_10px_oklch(0.78_0.16_210)]" />
                )}
              </>
            );

            if (item.disabled) {
              return (
                <div key={item.to} className={cls}>
                  {inner}
                </div>
              );
            }
            return (
              <Link key={item.to} to={item.to} className={cls}>
                {inner}
              </Link>
            );
          })}
        </nav>

        {/* Credit widget — shows "Owner • Unlimited" for admins, plan progress for customers */}
        <CreditWidget />

        {/* User pill */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="glass-panel mt-auto flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-white/5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--gradient-aurora)] text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{companyName}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {email}
                </div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onClick={async () => {
                await supabase.auth.signOut();
                nav({ to: "/login" });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
