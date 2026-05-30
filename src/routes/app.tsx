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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  ];

  const initials = (email ?? "U")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

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

        {/* Pro Plan card */}
        <div className="glass-panel mt-4 rounded-xl p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Pro Plan</span>
            <span className="rounded-full bg-[var(--gradient-aurora-soft)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground/80">
              Active
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">Resets in 14 days</p>
          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-[var(--gradient-aurora)]"
              style={{ width: "70%" }}
            />
          </div>
          <p className="font-mono-num text-[11px] text-muted-foreground">
            4,200 / 6,000 credits
          </p>
        </div>

        {/* User pill */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="glass-panel mt-3 flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-white/5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--gradient-aurora)] text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">Aurora Labs</div>
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
