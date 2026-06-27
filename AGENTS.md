# NexusAi / Lead Friend Finder

B2B sales prospecting tool. Deployed at lead-friend-finder.lovable.app.

## Stack

- **Runtime:** Bun (not npm)
- **Framework:** TanStack Start (SSR React 19)
- **Build:** Vite 7 + @vitejs/plugin-react
- **Styling:** Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Backend:** Supabase (vjvjkbarolcowxblpche)
- **Payments:** Stripe
- **Calling:** Twilio + RingCentral
- **AI SDK:** @ai-sdk/react + Vercel AI SDK
- **Deploy:** Cloudflare Workers via Wrangler

## Commands

- `bun dev` — start dev server
- `bun run build` — production build
- `bun run build:dev` — dev build
- `bun run lint` — eslint
- `bun run format` — prettier

## Conventions

- Use `bun` for package management, not npm
- TypeScript strict mode
- shadcn/ui components are in src/components/ui/
- Tailwind v4 with tw-animate-css for animations
- Zod for validation, react-hook-form for forms
- lucide-react for icons

## Known Issues

- People search has bugs (migration 20260626000000_fix_people_search_bugs.sql fixes 3 issues but hasn't been pushed)
- This was previously built/managed via Lovable; the goal is to move to independent development
