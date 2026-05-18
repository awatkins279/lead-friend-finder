import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, Users, Mail, Linkedin, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Forge AI — All-in-one B2B sales tool" },
      {
        name: "description",
        content:
          "Find leads, send email, and reach prospects on LinkedIn — all in one workspace.",
      },
    ],
  }),
});

function Landing() {
  const nav = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/app/people" });
    });
  }, [nav]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary p-2 text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold">Forge AI</span>
        </div>
        <Link to="/login">
          <Button size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3 w-3" /> All-in-one sales workspace
        </span>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight md:text-6xl">
          Find leads. Reach them. <br />
          <span className="text-muted-foreground">Close more deals.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          A B2B sales tool to pull leads from your database, filter by job title and
          company, and reach them by email or LinkedIn — without juggling tabs.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/login">
            <Button size="lg" className="gap-2">
              Get started <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <div className="mt-20 grid gap-4 text-left md:grid-cols-3">
          {[
            {
              icon: Users,
              title: "25,000+ leads ready",
              body: "Search by title, company, industry, location — instantly.",
            },
            { icon: Mail, title: "Email outreach", body: "Send personalized campaigns. (Coming soon)" },
            { icon: Linkedin, title: "LinkedIn touches", body: "Connect & message prospects. (Coming soon)" },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border bg-background p-5">
              <Icon className="mb-3 h-5 w-5 text-primary" />
              <div className="font-medium">{title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
