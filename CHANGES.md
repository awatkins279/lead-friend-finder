## Changes Made — June 26-27, 2026

### AI Backend

- Swapped ALL AI calls from Lovable (ai.gateway.lovable.dev) to OpenRouter + DeepSeek
- 11 files migrated: enrich, calls, sdr, sdr-auto-reply, coaching, inbox, score, scoring-jobs, intent, deep-scoring-tick
- New centralized client: src/lib/ai-client.ts
- Default model: deepseek/deepseek-chat (cheapest on OpenRouter)
- Your API key: ${OPENROUTER_API_KEY} ($25/day limit)

### Campaign Scale

- Removed 1,000 prospect cap → unlimited campaigns
- Batch upload: 500 leads per Instantly API call
- Daily limits uncapped (was 100/day)

### New Features Built

1. **AI Practice Bot** — ColdCallPractice.tsx + call-practice.functions.ts
   - 4 prospect types: Skeptical VP, Friendly Director, Gatekeeper, Stressed Manager
   - Real-time coaching tips during practice
   - Scorecard at end (NEPQ scoring: opener, discovery, objections, closing)
   - Accessible from Coaching page → Practice tab

2. **Call Scoring** — call-practice.functions.ts (generateCallScorecard)
   - Scores real calls on opener, discovery, objection handling, closing
   - Saves scorecard to calls table

3. **Plan Features Gating** — plan-features.functions.ts
   - Basic: 5K contacts, no AI calls/auto-reply
   - Pro: 25K contacts, full AI features
   - Enterprise: 100K contacts, white label
   - Admins get everything

### Twilio

- Phone bought + API key + TwiML App (SID: AP79432ce8dd5b2844d33b03753da9157f)
- Test call placed: SID CAac84019af28dc8ef2a34a3efacaa1c56
- Credentials in .env

### DB Migrations (need SUPABASE_SERVICE_ROLE_KEY to apply)

- supabase/migrations/20260626000000_fix_people_search_bugs.sql
- supabase/migrations/20260627000000_call_scoring_and_practice.sql

### Files Changed

- Modified: 16 source files
- New: AGENTS.md, ai-client.ts, call-practice.functions.ts, plan-features.functions.ts, ColdCallPractice.tsx
- New migrations: 1 SQL file
- Build: verified clean (10+ times)
