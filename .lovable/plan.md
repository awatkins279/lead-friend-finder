# AI SDR — Reusable Agents, Assigned to Campaigns

Change from previous plan: the SDR is a **reusable account-level resource** (like phone accounts on the Accounts tab), not a per-campaign blob. You build one or more "AI SDR Agents" once, then attach an agent to any campaign to turn it on for that list.

## Where it lives in the UI

New tab on `/app/accounts` (next to Phone accounts, Provider accounts, Saved searches):

**"AI SDR Agents"** — list of agents the user has created. Each row: name, persona, inbox connected (gmail/outlook/imap), # campaigns using it, status (ready / needs setup), edit / duplicate / delete.

"+ New SDR Agent" opens a multi-step dialog:
1. **Identity** — agent name, SDR display name, signature, tone (friendly/consultative/direct/playful), formality slider
2. **Inbox** — connect Gmail (OAuth), Outlook (OAuth), or IMAP/SMTP. Replies are sent FROM this inbox so threading works.
3. **Offer template** (defaults, overridable per campaign) — what you sell, top differentiators, hard rules ("never quote pricing"), handoff triggers (refund/legal/angry → human)
4. **Response behavior** — response speed window (instant / 5–30 min / 30 min–2 hr / 2–8 hr, random within), mode (Draft only / Auto-send w/ approval / Full auto-send), confidence threshold for full-auto, booking link (Calendly/Cal.com)
5. **Knowledge base** — upload PDFs/DOCX/TXT/MD up to 25 MB each (case studies, pricing sheet, FAQ, product docs). Files are chunked + embedded for RAG. KB is owned by the agent, shared across every campaign it's assigned to.

Agent is "ready" once: identity filled + inbox connected. KB optional but recommended.

## Assigning to a campaign

On the campaign page (`/app/lists/$listId`), a new section **"AI SDR"** with a dropdown:

> Active SDR agent: `[none ▾]` `[ Sarah — Gmail ▾]`

Picking an agent flips the campaign to "SDR active" — from that moment forward, any inbound reply to emails sent from this campaign is handled by that agent. Switching to "none" pauses replies (drafts stop being generated; in-flight scheduled sends are cancelled).

Optional per-campaign overrides (collapsed by default): override hard rules, override booking link, override mode for this campaign only. Falls back to the agent's defaults.

## Why this shape is better
- One Gmail connection works across all the user's campaigns.
- One KB (e.g. company case studies) is shared; no re-uploading per list.
- Customers selling multiple products can build one agent per product and assign accordingly.
- Matches how Phone accounts already work in this app — same mental model.

## Inbox UI

`/app/sdr` route (new top-level nav item, shown only if ≥1 agent exists):
- Threads grouped by agent → campaign → lead
- Thread view: full conversation, AI's draft, edit / approve / send / regenerate / mark handled
- "Why this reply" panel: which KB chunks were cited + intent + confidence

## Pipeline (per inbound reply)

1. Webhook / 2-min poll picks up new message on a thread we sent from
2. Look up `campaign → assigned agent` (skip if no agent assigned)
3. Classify intent (Flash, ~$0.0005): interested / objection / question / OOO / unsubscribe / handoff / other
4. `unsubscribe` → mark DNC, no reply. `OOO` → reschedule, no reply. `handoff` → notify user, draft only.
5. RAG: top-5 chunks from that agent's KB
6. Generate reply (Flash std / GPT-5 premium), with offer + tone + hard rules + RAG + thread history
7. Save to `sdr_messages` as `draft` or `scheduled` based on agent's mode + confidence
8. Cron flushes scheduled outbound through the agent's connected inbox

## Cost per reply

~$0.005 on Flash → 1k inbound replies/mo ≈ $5 raw AI cost. Customers selling more typically reply more, so usage scales with their success.

## Technical changes

### New DB tables
- `sdr_agents` — id, user_id, name, persona JSONB, tone, mode, speed_window, confidence_threshold, booking_url, hard_rules, handoff_triggers, default_offer JSONB, inbox_account_id
- `sdr_inbox_accounts` — id, user_id, provider (gmail/outlook/imap), email_address, encrypted_tokens, oauth_refresh
- `sdr_knowledge_docs` — id, agent_id, filename, storage_path, status, tokens
- `sdr_knowledge_chunks` — id, doc_id, agent_id, content, embedding vector(1536) (pgvector)
- `sdr_conversations` — id, agent_id, list_id, lead_id, thread_id, intent, status, last_inbound_at
- `sdr_messages` — id, conversation_id, direction, body, subject, ai_generated, kb_citations, confidence, scheduled_for, sent_at
- `lists` gets `sdr_agent_id uuid null` + optional override columns

### New storage bucket
- `sdr-knowledge` (private), path `{user_id}/{agent_id}/{filename}`

### Server functions
- `listSdrAgents`, `upsertSdrAgent`, `deleteSdrAgent`
- `connectInbox` (OAuth callback), `disconnectInbox`
- `uploadKnowledgeDoc` (signed URL) → background `processKnowledgeDoc` (parse → chunk → embed)
- `assignAgentToList`, `unassignAgentFromList`
- `getSdrInbox`, `getSdrThread`, `regenerateReply`, `approveAndSendReply`

### Public routes
- `/api/public/sdr/gmail-webhook`, `/api/public/sdr/outlook-webhook`
- `/api/public/sdr/poll` (cron, 2 min — IMAP + fallback)
- `/api/public/sdr/send-scheduled` (cron, 1 min)

### Secrets needed at build time
- Gmail OAuth client ID + secret
- Outlook OAuth client ID + secret
- IMAP creds are per-agent, stored encrypted

## Build order
1. DB schema + storage bucket
2. Accounts tab → "AI SDR Agents" list + create/edit dialog (identity + offer + behavior only — no inbox yet)
3. Knowledge base upload + chunk/embed pipeline
4. Inbox OAuth (Gmail first, then Outlook, then IMAP)
5. Campaign page → "Assign SDR agent" dropdown
6. Classifier + responder + RAG
7. `/app/sdr` inbox UI
8. Cron scheduler + scheduled send flush

## Open questions (4 quick ones)

1. **Inbox priority**: ship Gmail OAuth first and add Outlook + IMAP in a follow-up? Or all three in v1?
2. **Sending**: replies go out through the user's connected inbox (best threading + deliverability) — confirm that's fine vs. routing through Resend/SendGrid?
3. **KB size cap per agent**: 50 MB / 500 MB / unlimited with usage pricing?
4. **Default mode for new agents**: Draft-only (safer) or Auto-send with high confidence threshold (more wow)?
