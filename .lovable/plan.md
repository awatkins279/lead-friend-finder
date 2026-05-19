
# Cold Calling Module — Implementation Plan

A new product surface, fully separated from Email. Each campaign gets two tabs: **Email** (existing) and **Calling** (new). Reps dial from the browser, read an AI-personalized script, and get a Jeremy-Miner-style scorecard after each call.

---

## 1. Campaign UI restructure

- `app.lists.$listId.tsx` becomes a tabbed shell: **Email** | **Calling**.
- Existing email config + lead table moves under the Email tab unchanged.
- New **Calling** tab contains:
  - Calling campaign config (script template, tone, objectives, objection map)
  - Lead table with a "Call" button per lead (replaces/parallels "Generate emails")
  - Call history + scorecards

## 2. Calling campaign config (per list)

New table `list_call_configs` storing:
- `script_template` — user's base script (optional; AI uses NEPQ default if blank)
- `personalization_level` — low / medium / high
- `objectives` — what a successful call looks like
- `objection_notes` — common objections + preferred responses
- `tone` — consultative / direct / friendly
- `record_calls` — bool (default true, with consent disclaimer field)
- `consent_disclaimer` — text auto-prepended to scripts in 2-party states

UI mirrors the existing `CampaignConfigDialog` pattern.

## 3. Per-rep Twilio auth

Each rep connects their own Twilio sub-account or uses a shared workspace number:
- New table `user_phone_accounts` (user_id, twilio_account_sid, twilio_api_key_sid, twilio_api_key_secret encrypted, from_number, caller_id_verified)
- "Sending Accounts" page gets a "Phone Numbers" section to add Twilio creds + verify caller ID
- Server function mints short-lived Twilio Voice **Access Tokens** per request — browser SDK never sees the API secret

## 4. In-browser dialer + teleprompter

New route `/app/lists/$listId/call/$leadId`:
- Left pane: large teleprompter (text-size slider, default 22px, scrollable, auto-advance optional)
- Right pane: dial pad, mute, hangup, call timer, live status
- Bottom pane: collapsible "Objection cheat sheet" — pre-generated responses keyed by objection type
- Uses `@twilio/voice-sdk` in browser; token fetched from `getTwilioToken` server fn
- TwiML app routes the call through a server route at `/api/public/twilio/voice` that dials the lead's number with `record="record-from-answer-dual"` and `recordingStatusCallback` pointing at `/api/public/twilio/recording`

## 5. AI script generation

Server fn `generateCallScript({ leadId, listId })`:
- Pulls lead intel (same data the email generator uses) + calling config + NEPQ system prompt
- Returns structured script: `opener`, `problem_questions[]`, `solution_questions[]`, `consequence_questions[]`, `qualifying_questions[]`, `close`, `objection_map`
- Cached per lead in `list_leads.call_script` JSONB so re-opening is instant
- Regenerate button forces refresh

NEPQ system prompt is hardcoded now; later we add a `knowledge_documents` table + RAG (pgvector) and inject retrieved Jeremy Miner chunks into the prompt. Prompt has a clear `{{KNOWLEDGE_BASE}}` slot so the swap is a one-line change.

## 6. Recording + transcription pipeline

1. Twilio records the call → hits our `recordingStatusCallback` webhook with a signed payload
2. We verify Twilio signature, store row in `call_recordings` (call_sid, lead_id, list_id, user_id, recording_url, duration_sec, status='pending_transcription')
3. Background job (triggered immediately, retried via pg_cron every 5 min for stuck rows) downloads the recording, sends it to **Deepgram Nova-3** for diarized transcription
4. On transcript ready → run scorecard AI step → store result, status='complete'
5. UI polls / realtime-subscribes to `call_recordings` for live status

## 7. AI scorecard (post-call)

Server fn `scoreCall({ recordingId })` returns structured JSON:
- `overall_score` (1-10)
- `nepq_breakdown`: connecting / situation / problem-awareness / solution-awareness / consequence / qualifying / transition / commitment
- `objections_detected[]` with `{ objection, your_response, better_response, why }`
- `tonality_notes` (pace, filler words, talk/listen ratio from diarization)
- `better_questions[]` — specific questions Jeremy Miner would have asked instead
- `wins[]` and `key_moments[]` (timestamped)
- `next_step_recommendation`

Rendered as an expandable card on the lead row + a dedicated "Call review" page with audio player + transcript synced to timestamps.

## 8. Compliance guardrails (built in, not optional)

- Recording consent disclaimer auto-injected into script opener
- TCPA: warning banner before calling any number flagged as mobile in any 2-party-consent state (CA, FL, IL, MD, MA, MT, NV, NH, PA, WA)
- DNC: simple "do not call" toggle per lead; calling button disabled if set
- Rate limit per rep: max 200 dials/day to prevent flagging

---

## What I need from you

**Before I start coding (none of this blocks the plan, but they unblock me when I get to that step):**

1. **Twilio account** — create one at twilio.com, buy a phone number (~$1/mo), and have the Account SID + Auth Token ready. I'll request them via the secrets tool when I'm ready to wire it up.
2. **Deepgram account** — sign up at deepgram.com (free tier covers ~$200 of usage), grab the API key.
3. **TwiML App** — I'll give you exact steps in the Twilio console once Phase 1 starts (it's 3 fields).
4. **Jeremy Miner data** — whenever ready. Send transcripts, PDFs, course notes — anything text. Phase 1 ships without it; Phase 2 wires the upload + RAG.

---

## Technical notes (for reference)

- Stack: Twilio Voice JS SDK 2.x (browser) + Twilio REST via gateway (server) + Deepgram REST + Lovable AI Gateway for script/scorecard
- All telephony server logic in `src/routes/api/public/twilio/*.ts` (signed webhooks) + `src/lib/calls.functions.ts` (RPC from UI)
- Audio storage: Twilio hosts recordings 30 days free; we mirror to Lovable Cloud Storage for long-term + transcript-aligned playback
- Cost ballpark, 1 rep × 100 dials/day × 3 min avg: ~$4.20 Twilio + ~$1.30 Deepgram + ~$2-4 AI = **~$8-10/day per rep**

---

## Build order

**Phase 1 (this build):** Tabs, calling config, per-rep Twilio, browser dialer, teleprompter, AI script generation, recording capture. Reps can call and read scripts end-to-end; recordings stored.

**Phase 2 (next):** Deepgram transcription + NEPQ scorecard + call review page.

**Phase 3 (later):** Jeremy Miner knowledge upload + RAG.

Phase 1 is roughly 60% of the engineering. Confirm and I'll start.
