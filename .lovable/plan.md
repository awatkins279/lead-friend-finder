# Browser-based RingCentral calling (WebRTC)

Today RingCentral calls use **RingOut**: we phone the rep's `ring_to_number`, they pick up their desk/cell phone, then RingCentral bridges to the prospect. We're going to replace that with RingCentral's **WebRTC Web Phone**, so audio runs through the laptop's mic + speakers — same UX the Twilio path already has.

## How RingCentral WebRTC works

RingCentral does not expose a "browser token" like Twilio. Instead:

1. Server exchanges the existing **JWT** (with `client_id` / `client_secret`) for an OAuth access token.
2. Server calls `POST /restapi/v1.0/client-info/sip-provision` with that token to mint short-lived **SIP credentials** (username, password, WSS server, domain, auth-id). This is the only safe place for this — it requires the client secret.
3. Browser passes those SIP credentials into the **`@ringcentral/web-phone`** SDK, which opens a WebSocket → SIP/WSS session to RingCentral's edge and uses WebRTC for the media stream.
4. `webPhone.userAgent.invite(toNumber)` places the call from the browser. The rep's mic captures their voice; the prospect's audio is piped to the `<audio>` element the SDK manages. Mute, hangup, and DTMF are all SDK methods.

No phone hardware involved. Uses the existing `client_id`, `client_secret`, `jwt`, and `server_url` already stored on the phone account.

## Changes

### Backend — `src/lib/calls.functions.ts`

- Add `getRingCentralSipProvision` server function:
  - Input: `phoneAccountId`.
  - Loads the RC account, runs the same JWT → access_token exchange already used by `startRingOutCall`.
  - Calls `POST {server_url}/restapi/v1.0/client-info/sip-provision` with body `{ sipInfo: [{ transport: "WSS" }] }`.
  - Returns the JSON SIP-provision payload plus the `access_token` and `from_number` (caller ID).
- Add `startRingCentralWebCall` server function (mirror of `startCall`): inserts a `calls` row with `provider=ringcentral`, `status=initiated`, returns `callId`. Used so the call shows up in history / outcomes.
- Keep `startRingOutCall` for now but it will no longer be wired into the UI. (Safe to delete in a follow-up.)

### Frontend — `src/routes/app.lists.$listId.tsx` (`CallWorkstation`)

- Add `bun add @ringcentral/web-phone sip.js` (the SDK pulls SIP.js as a transport).
- Replace `startRingOutFn` usage with new flow when `phoneAccount.provider === "ringcentral"`:
  1. Call `getRingCentralSipProvision({ phoneAccountId })`.
  2. Lazy-import `RingCentralWebPhone` (browser-only).
  3. Instantiate once, register, store in a ref alongside the existing Twilio `device` state.
  4. Call `startRingCentralWebCall` to get `callId`.
  5. `webPhone.userAgent.invite(toNumber, { fromNumber })` → returns a session.
  6. Wire session events (`progress` → ringing, `accepted` → in_progress, `terminated`/`failed` → `finishCall`) into the same `callStatus` state machine the Twilio path uses.
- Reuse the existing mute button: route it to `session.mute()` / `unmute()` when the active call is RingCentral, otherwise the current Twilio path.
- Reuse the existing hang-up: `session.terminate()` on the RingCentral path.
- Cleanup on unmount: also call `webPhone.userAgent.unregister()` and dispose the audio element.

### UX

- Same in-app call panel; the toast that today says "RingCentral is calling your phone — answer to connect" gets replaced with the normal `Connecting…` → `Ringing…` → `In progress` flow, identical to Twilio.
- Browser will prompt for mic permission the first time the rep places an RC call.

## Technical details

```text
JWT (stored) ──► OAuth token ──► /client-info/sip-provision
                                            │
                                            ▼
                                  { sipInfo: [{ wsServers, domain,
                                                authorizationId,
                                                username, password }],
                                    sipFlags, sipErrorCodes }
                                            │
                          (returned to browser via server fn)
                                            ▼
                            new RingCentralWebPhone(provision,
                                { appKey: client_id,
                                  appName: "Lovable SDR",
                                  appVersion: "1.0.0",
                                  uuid: <stable per device> })
                                            │
                                            ▼
                            webPhone.userAgent.invite("+1...")
                                            │
                                            ▼
                            WebRTC audio ↔ rep's mic/speakers
```

Notes:
- `ring_to_number` becomes unused for placing calls; it can stay on the account record (still useful for fallback / display).
- The SIP-provision token is short-lived (~1h); we mint on demand, no caching needed for v1.
- Server function returns SIP credentials over HTTPS; they're scoped to a single SIP session — same security profile as the Twilio access token we already return today.
- No new env vars or secrets — uses existing `credentials` on `user_phone_accounts`.

## Out of scope

- Inbound calls (we only place outbound from a campaign).
- Call recording (RC web phone supports it; can wire later).
- Removing `startRingOutCall` / the old "your phone rings first" copy in docs.
