import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Mail, Link2 as Linkedin, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "NexusAi — All-in-one B2B sales tool" },
      {
        name: "description",
        content:
          "Find leads, send email, and reach prospects on LinkedIn — all in one warm, focused workspace.",
      },
    ],
  }),
});

function BrandMark() {
  return (
    <div className="flex items-center gap-2 group">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-[oklch(0.72_0.18_45)] to-[oklch(0.68_0.20_15)] shadow-lg shadow-orange-200/60 rotate-3 group-hover:rotate-12 transition-transform duration-300" />
      <span className="text-xl font-bold tracking-tight text-zinc-900">NexusAi</span>
    </div>
  );
}

function Landing() {
  const nav = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/app/people" });
    });
  }, [nav]);

  const features = [
    {
      icon: Users,
      title: "25,000+ leads ready",
      body: "Search by title, company, industry, location — instantly.",
      iconBg: "bg-orange-100",
      iconText: "text-orange-600",
      hoverBorder: "hover:border-orange-200",
      hoverShadow: "hover:shadow-orange-200/60",
      tag: null,
      tagColor: "",
    },
    {
      icon: Mail,
      title: "Email outreach",
      body: "Send personalized campaigns tailored to each prospect.",
      iconBg: "bg-purple-100",
      iconText: "text-purple-600",
      hoverBorder: "hover:border-purple-200",
      hoverShadow: "hover:shadow-purple-200/60",
      tag: "Coming soon",
      tagColor: "text-purple-400",
    },
    {
      icon: Linkedin,
      title: "LinkedIn touches",
      body: "Connect and message prospects directly where they are.",
      iconBg: "bg-rose-100",
      iconText: "text-rose-600",
      hoverBorder: "hover:border-rose-200",
      hoverShadow: "hover:shadow-rose-200/60",
      tag: "Coming soon",
      tagColor: "text-rose-400",
    },
  ] as const;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#fffcf9] text-zinc-900">
      {/* Aurora gradient blobs */}
      <div className="pointer-events-none absolute -top-[10%] -left-[10%] h-[50%] w-[50%] rounded-full bg-orange-200/40 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-[5%] right-0 h-[50%] w-[40%] rounded-full bg-purple-200/30 blur-[120px]" />
      <div className="pointer-events-none absolute top-[20%] right-[10%] h-[40%] w-[30%] rounded-full bg-rose-200/30 blur-[100px]" />

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 py-10 md:py-12">
        {/* Header */}
        <div className="mb-16 flex w-full items-center justify-between md:mb-24">
          <BrandMark />
          <Link
            to="/login"
            className="px-5 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Sign in
          </Link>
        </div>

        {/* Hero */}
        <div className="flex max-w-4xl flex-col items-center text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/60 px-3 py-1 shadow-sm backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-orange-700/80">
              All-in-one sales workspace
            </span>
          </div>

          <h1 className="mb-6 bg-gradient-to-b from-zinc-900 to-zinc-600 bg-clip-text text-5xl font-extrabold leading-[1.1] tracking-tight text-transparent md:text-7xl">
            Find leads. Reach them.
            <br />
            Close more deals.
          </h1>

          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-zinc-500 md:text-xl">
            A B2B sales tool to pull leads from your database, filter by job title and company, and
            reach them by email or LinkedIn — without juggling tabs.
          </p>

          <Link
            to="/login"
            className="group flex items-center gap-2 rounded-2xl bg-zinc-900 px-8 py-4 font-bold text-white shadow-xl shadow-zinc-200 transition-all duration-300 hover:-translate-y-1 hover:bg-orange-600 hover:shadow-orange-200"
          >
            Get started
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Features */}
        <div className="mt-20 grid w-full grid-cols-1 gap-6 md:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className={`group rounded-[32px] border border-white/80 bg-white/40 p-8 backdrop-blur-xl transition-all duration-500 ${f.hoverBorder} hover:-translate-y-1 hover:bg-white/70 hover:shadow-2xl ${f.hoverShadow}`}
              >
                <div
                  className={`mb-6 flex h-12 w-12 items-center justify-center rounded-2xl ${f.iconBg} transition-transform group-hover:scale-110`}
                >
                  <Icon className={`h-6 w-6 ${f.iconText}`} />
                </div>
                <h3 className="mb-3 text-xl font-bold text-zinc-900">{f.title}</h3>
                <p className="leading-relaxed text-zinc-500">{f.body}</p>
                {f.tag && (
                  <span
                    className={`mt-3 block text-xs font-bold uppercase tracking-wider ${f.tagColor}`}
                  >
                    {f.tag}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
