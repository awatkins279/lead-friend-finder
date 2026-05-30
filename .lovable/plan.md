# Real-Time AI Call Co-Pilot

Transform the call workstation from a teleprompter into a live AI co-pilot that listens to both sides of the call, follows along with what the rep says, and generates dynamic coaching (objection handlers, next-best-line) on the fly — grounded in a trainer-style global prompt + per-campaign knowledge.

---

## Hard Dependencies (read first)

### 1. Calling provider must switch to Twilio for the AI co-pilot

You picked **true dual-channel audio (rep + prospect on separate streams)**. RingCentral RingOut bridges the call on their PSTN — the browser never sees the audio, so we cannot transcribe it. The only way to get both sides separately is the **Twilio Voice SDK in the browser** (already integrated in `getTwilioToken` / `startCall` — just not the default path).

**Implication:** When the user starts a call from a campaign with AI co-pilot enabled, we route it through Twilio, not RingCentral. RingCentral stays available as a fallback (no AI co-pilot in that mode). Calls/logs/recordings work the same way.

### 2. We need a Deepgram API key

Deepgram streaming gives ~300ms transcript latency and the cleanest dual-channel handling. I'll request `DEEPGRAM_API_KEY` once you approve. Cost ~$0.0043/min — a 5-min call is ~$0.02.

### 3. Lovable AI Gateway for dynamic coaching

`google/gemini-3-flash-preview` for sub-second suggestions. Already configured via `LOVABLE_API_KEY`.

---

## What the rep sees during a live call

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Allan Watkins  · Sales Rep · TTMUSA              ● LIVE  02:14       │
├──────────────────────────────────┬───────────────────────────────────┤
│  SCRIPT (auto-following)         │  AI CO-PILOT (live)               │
│                                  │                                   │
│  ✓ Opener                        │  ► Prospect said:                 │
│  ► Pattern interrupt  ← you here │    "We already use Outreach"      │
│    "Hey Allan, this is..."       │                                   │
│    [highlighted as you speak]    │  💡 Suggested response (NEPQ):    │
│                                  │    "That makes sense — most       │
│  ○ Pain framing                  │    folks I talk to do. What's     │
│  ○ Solution questions            │    the one thing about it that    │
│  ○ Close                         │    drives you up the wall?"       │
│                                  │                                   │
│                                  │  🎯 Next move: stay curious,      │
│  Live transcript ▾               │    don't pitch. Get pain in       │
│  Rep: "I'll keep it super..."    │    their words first.             │
│  Prospect: "We already use..."   │                                   │
└──────────────────────────────────┴───────────────────────────────────┘
```

- **Script auto-follows** the rep's voice (no more pressing Play — current section highlights as the rep speaks the words).
- **AI co-pilot panel** replaces the static objection cards. Suggestions are generated live by the AI based on the actual conversation, grounded in the global trainer style + per-campaign knowledge.
- **Live transcript** is collapsible at the bottom for reference.

---

## Phased build

### Phase 1 — Backend & data foundation (no UI changes yet)
1. **Migration**: add tables
   - `coaching_styles` — global trainer styles (admin uploads): name, system_prompt, hard_rules, example_objection_handlers. Read-only to users.
   - `coaching_knowledge_docs` + `coaching_knowledge_chunks` — per-campaign knowledge base (customer uploads PDFs/text). Reuses pattern from `sdr_knowledge_*`.
   - `lists.coaching_style_id` (nullable FK → coaching_styles, default = whichever you set as system default)
   - `call_live_events` — every transcript chunk + AI suggestion for replay/training (call_id, role, text, ts, kind)
2. **Storage bucket**: `coaching-knowledge` (private, RLS scoped to list owner)
3. **Storage bucket**: `coaching-styles` (private, admin-only writes)
4. **Server fns** in `src/lib/coaching.functions.ts`:
   - `listCoachingStyles` (any user, read)
   - `upsertCoachingStyle` (admin only)
   - `uploadCampaignKnowledge`, `listCampaignKnowledge`, `deleteCampaignKnowledge`
   - `getDeepgramToken` — mints a short-lived temporary key for the browser
   - `generateLiveSuggestion` — takes recent transcript window + style + knowledge chunks, returns `{ matched_script_section_id, suggestion_text, intent: "objection"|"continue"|"close", confidence }`. Uses Lovable AI gateway.

### Phase 2 — Audio capture & live transcription
1. **Twilio call path**: wire the existing `getTwilioToken` + `startCall` server fns into a new `useTwilioCall` hook. Bridges browser mic → Twilio → prospect, with both legs exposed as MediaStreams.
2. **`useLiveTranscript` hook**: opens a Deepgram WebSocket per call, sends two channels (channel 0 = rep mic, channel 1 = remote audio from Twilio peer connection), emits `{role: "rep"|"prospect", text, isFinal, ts}` events.
3. **Persist** each final transcript chunk to `call_live_events`.

### Phase 3 — Live script following
1. **Embed script sections** when the script is generated (one embedding per `talk_track` item, opener, close — using `google/gemini-embedding-001`).
2. **Live matcher**: every time a rep transcript chunk arrives, compute its embedding and find the closest script section via cosine similarity. Smooth with a 3-chunk window so it doesn't jump around.
3. **UI**: replace the auto-scrolling teleprompter with a sectioned list. Active section gets the gradient border + soft glow already in the design. Played sections dim.

### Phase 4 — AI co-pilot panel (the big one)
1. Replace the static `OBJECTION ANSWERS` panel with a live feed driven by `generateLiveSuggestion`.
2. **Trigger logic**: every time the *prospect* finishes a sentence (Deepgram `is_final` + `speech_final`), call `generateLiveSuggestion` with:
   - Last ~30s of transcript (both sides)
   - The campaign's selected `coaching_style` system prompt
   - Top-3 retrieved chunks from per-campaign `coaching_knowledge_chunks` (vector search on the prospect's last utterance)
   - The lead's enrichment data (already on `leads`)
   - The full call script as soft reference
3. Stream the suggestion token-by-token into the panel.
4. Suggestions stack newest-on-top, each with intent badge (`OBJECTION` / `DISCOVERY` / `CLOSE`), the prospect quote that triggered it, and the suggested response.

### Phase 5 — Knowledge & style management
1. **`/app/coaching-styles`** (admin only): list/create/edit global trainer styles. Big system-prompt textarea, hard-rules textarea, file uploads for trainer materials.
2. **Campaign config dialog** (`CampaignConfigDialog`): add a "Coaching" tab — pick a coaching style, upload per-campaign knowledge docs (the "what we sell" knowledge center you described).
3. Knowledge chunking + embedding runs in the upload server fn (mirrors `sdr-agents` flow).

### Phase 6 — Fallbacks & polish
- If Deepgram fails → fall back to browser Web Speech API with a yellow warning banner.
- If Lovable AI fails → keep the script auto-follow working, hide the co-pilot panel with a graceful error.
- "Pause AI" toggle in the header so reps can mute suggestions when they're flowing.
- Post-call summary: AI scorecard using the full transcript + intent timeline.

---

## What stays the same
- RingCentral path keeps working as-is for reps who don't want AI co-pilot (toggle per call or per campaign).
- Voicemail drop, dialer hotkeys, prospect navigation, call logging all untouched.
- The existing teleprompter mode stays available as "Manual mode" if the rep prefers it.

---

## Approval needed before I start
1. **Confirm Twilio for AI-enabled calls** (RingCentral stays as the non-AI option). If you'd rather keep RingCentral as the only path, the co-pilot can only transcribe the rep's side — coaching quality drops a lot.
2. **OK to request `DEEPGRAM_API_KEY`?** I'll trigger the secrets prompt right after you approve.
3. **OK to start with Phase 1 (migrations + bare-bones server fns) and Phase 5 (knowledge upload UI)** in the first build? That gets the data layer + your trainer-style uploader live so you can start filling it in while I build the live audio pieces in the next pass.

Reply with which phases to bundle into the first build and I'll start.
