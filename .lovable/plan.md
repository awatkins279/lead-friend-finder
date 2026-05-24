## What's actually broken

Looking at the dev server logs, the real error isn't the RingCentral SDK at all — it's a CSS bug in `src/styles.css`:

```
[vite:css][postcss] @import must precede all other statements
```

The file currently has:
```
1: @import "tailwindcss" source(none);
2: @source "../src";          ← non-@import statement
3: @import "tw-animate-css";  ← @import AFTER a non-import → CSS spec violation
4: @import url("...Plus Jakarta Sans...");
5: @import url("...Urbanist + Epilogue...");
```

CSS requires all `@import` rules to come before any other statement. PostCSS rejects the file, the page can't render, and you see the blank screen / "SSR rendering failed". This was likely introduced when fonts were added in an earlier turn — not by the RingCentral work.

The RingCentral WebRTC code is already correctly lazy-imported inside a click handler, so it never runs during SSR. No code change needed there.

## The fix (one tiny edit)

Reorder the first 5 lines of `src/styles.css` so every `@import` comes first:

```
@import "tailwindcss" source(none);
@import "tw-animate-css";
@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans...");
@import url("https://fonts.googleapis.com/css2?family=Urbanist...");
@source "../src";
```

That's it. After this the page will render, and the calling button will work.

## What you need to do on your end (for actually placing a test call)

The browser-calling feature needs your RingCentral account configured as a **WebRTC-capable app**, not just any RingCentral account. Here's how to check:

1. Go to **developers.ringcentral.com** → your app → **Settings**
2. Under **App Permissions**, make sure these are enabled:
   - **VoIP Calling** (this is the WebRTC one — without it, browser calls won't work)
   - **Read Accounts**
3. Under **Auth**, the grant type must include **JWT**
4. Then in this app, go to **Sending Accounts** → edit your RingCentral account and confirm these fields are filled:
   - Client ID
   - Client Secret
   - JWT token
   - "Your phone number" (the caller ID prospects will see)

If **VoIP Calling** isn't an available permission on your app, you'll need to either enable it (some RingCentral plans require contacting their support) or create a new app of type "Browser-Based" / "Web". That's the "RingCentral web thing" you were unsure about — it's a permission/app-type setting inside your existing RingCentral developer account, not a separate product you buy.

Once the CSS fix lands and your app has VoIP Calling enabled, hit a "Call" button on a lead — your browser will ask for mic permission, then dial the prospect with audio in/out through your computer.