# Unified Inbox

A single Outlook/Gmail-style hub at `/app/inbox` that merges every reply across every connected email account, every domain, and every campaign into one threaded view — with filters, intent labels, and a lightweight analytics strip on top.

Built now against the schema so the moment real inboxes start syncing (after your email-account meeting), threads, replies, and AI SDR drafts populate automatically.

## 1. Navigation

- New sidebar entry **Inbox** (Inbox icon) at the top of `/app/*`, above Lists.
- Route: `src/routes/app.inbox.tsx`.
- Badge with unread count on the sidebar item.

## 2. Layout (Outlook-style, 3 panes)

```text
┌──────────────────────────────────────────────────────────────────┐
│  Analytics strip (collapsible): replies · breakdown · top camp.  │
├────────────┬──────────────────────────┬─────────────────────────┤
│ Folders &  │ Thread list              │ Thread view             │
│ filters    │ (sender, snippet, time,  │ (full conversation,     │
│            │  intent badge, campaign) │  draft/reply composer)  │
│ • All      │                          │                         │
│ • Unread   │                          │                         │
│ • Needs    │                          │                         │
│   approval │                          │                         │
│ • Sent     │                          │                         │
│ • Archived │                          │                         │
│            │                          │                         │
│ Filters:   │                          │                         │
│ Campaign ▾ │                          │                         │
│ Intent ▾   │                          │                         │
│ Account ▾  │                          │                         │
│ Date ▾     │                          │                         │
│ Search     │                          │                         │
└────────────┴──────────────────────────┴─────────────────────────┘
```

- Left rail: folders + faceted filters.
- Middle: virtualized thread list, infinite scroll, keyboard nav (`j`/`k`, `e` archive, `r` reply).
- Right: thread with bubbles — inbound (gray, left) vs SDR outbound (primary, right). Header shows lead, company, campaign chip, assigned agent, "via {inbox@domain}". Footer composer: edit AI draft → Approve & send / Regenerate / Send manual reply.

## 3. Filters & search

- **Campaign**: multi-select from user's lists.
- **Intent**: Interested, Not interested, Objection, Question, Meeting booked, OOO/auto-reply, Unsubscribe, Other.
- **Account**: any of their `email_accounts` (so a domain switch is just selecting accounts).
- **Date**: presets (Today, Last 7d, Last 30d, Last month, Last year, Year before) + custom range.
- **Search**: subject / body / sender / company (Postgres `ilike` for v1).

All filters combine and persist in URL search params (TanStack `validateSearch`) so the view is shareable & restorable.

## 4. Analytics strip (top of inbox)

Compact cards, respects current filter set:

- Replies received (with trend vs previous period)
- Breakdown donut: Interested / Objection / Not interested / Other
- Reply rate per campaign (top 5)
- Avg. time-to-reply (SDR)
- Meetings booked

Click any segment → applies as a filter.

## 5. Data model (additive, no breaking changes)

Three new tables — designed to look identical regardless of which inbox the message came in on, so "unified" is the default state of the data.

```text
sdr_conversations
  id, user_id, agent_id (nullable), email_account_id, list_id (campaign),
  lead_id, lead_email, lead_name, company,
  subject, last_message_at, last_direction, unread_count,
  intent, intent_confidence, status (open|needs_approval|snoozed|archived|closed),
  meeting_booked_at, created_at, updated_at

sdr_messages
  id, conversation_id, user_id,
  direction (inbound|outbound), from_email, from_name, to_emails[], cc_emails[],
  subject, body_text, body_html, snippet,
  message_id (RFC), in_reply_to, references[],
  sent_at, received_at,
  ai_generated boolean, agent_id, status (draft|queued|sent|failed|received),
  raw jsonb

sdr_message_attachments  (id, message_id, filename, size, mime, storage_path)
```

RLS: everything scoped by `user_id`. Indexes on `(user_id, last_message_at desc)`, `(conversation_id, sent_at)`, `(user_id, intent)`, `(user_id, list_id)`.

Existing `sdr_agents`, `email_accounts`, `lists` (campaigns), `leads` already wire in.

## 6. Server functions (`src/lib/inbox.functions.ts`)

- `listConversations({ filters, cursor })` — paginated, joins campaign + account + agent for chips.
- `getConversation({ id })` — full thread + messages + lead context.
- `setConversationStatus({ id, status })` — archive/snooze/close.
- `setConversationIntent({ id, intent })` — manual override.
- `saveDraftReply({ conversationId, body })`, `approveAndSend({ messageId })`, `regenerateReply({ conversationId })` — stub the send path until inboxes connect (writes a `queued` message; the real sender plugs in later).
- `getInboxAnalytics({ filters })` — counts + breakdown + per-campaign rate, all in one aggregated query.

## 7. Ingestion stubs (ready, not wired)

Public route `src/routes/api/public/inbox.ingest.ts` accepts a normalized message payload (works for Gmail webhook, Outlook Graph subscription, or IMAP poller) and:

1. Looks up `email_account_id` by recipient.
2. Resolves campaign + lead via `In-Reply-To` / `References` headers (falls back to from-address match).
3. Upserts conversation (threaded by RFC references), inserts message, recomputes `unread_count` + `last_message_at`.
4. Triggers intent classification (Gemini Flash) async → updates `intent`/`intent_confidence`.
5. If the campaign has an SDR agent assigned and the agent's mode allows it, drafts a reply (RAG over `sdr_knowledge_chunks` you already built) and stores as `draft` or `queued` per agent's mode.

Same endpoint works for every provider once you have credentials — providers just translate their webhook into this shape.

## 8. Empty state (today)

Because no accounts are connected yet, the inbox renders with:

- The full UI shell, folders, filters, analytics cards (all zeros).
- A friendly empty banner: "No inboxes connected yet — head to Sending accounts → Email to add one. Your SDR replies will start landing here automatically."
- A "Load sample thread" toggle so you can demo the UI to the company tomorrow with realistic mock data (memory-only, not written to DB).

## 9. Out of scope (next pass, after credentials land)

- Actual Gmail OAuth / Outlook Graph / IMAP poller (separate ticket per provider).
- Outbound SMTP send pipeline.
- Attachment upload UI for composing.
- Mentions / internal notes / multi-user assignment.

---

### Technical notes

- Route: `src/routes/app.inbox.tsx` + child `src/routes/app.inbox.$conversationId.tsx` for deep-linking.
- New components: `InboxShell`, `InboxFilters`, `ConversationList`, `ConversationView`, `MessageBubble`, `ReplyComposer`, `InboxAnalyticsStrip`, `InboxEmptyState`.
- Data fetching follows the project's TanStack Query + `createServerFn` pattern with `requireSupabaseAuth`.
- Realtime: Supabase channel on `sdr_messages` filtered by `user_id` for live updates.
- Add `ALTER PUBLICATION supabase_realtime ADD TABLE public.sdr_messages, public.sdr_conversations;`.
- Sidebar unread badge subscribes to the same channel.

Approve this and I'll build it.