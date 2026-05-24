import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function getServerUrl(raw: string | undefined): string {
  const url = raw && /^https?:\/\//i.test(raw) ? raw : "https://platform.ringcentral.com";
  return url.replace(/\/$/, "");
}

function getRedirectUri(): string {
  const explicit = process.env.RINGCENTRAL_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.SITE_URL || "https://lead-friend-finder.lovable.app";
  return `${base.replace(/\/$/, "")}/api/ringcentral/oauth/callback`;
}

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;-webkit-font-smoothing:antialiased;background:#0a0a0a;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}.box{max-width:480px}.h{font-size:20px;font-weight:600;margin-bottom:8px}.p{color:#a3a3a3;font-size:14px;line-height:1.5}.ok{color:#4ade80}.err{color:#f87171}</style></head>
<body><div class="box">${body}</div>
<script>try{setTimeout(function(){window.close();if(window.opener)window.opener.postMessage({type:'ringcentral-oauth-done'},'*')},800)}catch(e){}</script>
</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export const Route = createFileRoute("/api/ringcentral/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") || "";
        const err = url.searchParams.get("error");

        if (err) {
          const desc = url.searchParams.get("error_description") || err;
          return htmlResponse(
            "Sign in failed",
            `<div class="h err">Sign in failed</div><div class="p">${desc}</div>`,
            400
          );
        }
        if (!code || !state) {
          return htmlResponse("Missing code", `<div class="h err">Missing authorization code</div>`, 400);
        }

        const phoneAccountId = state.split(".")[0];
        if (!phoneAccountId) {
          return htmlResponse("Bad state", `<div class="h err">Invalid state parameter</div>`, 400);
        }

        // Look up the account's client_id / client_secret (admin client — the
        // user already authorized this on developers.ringcentral.com, and the
        // state is unguessable).
        const { data: acc, error } = await supabaseAdmin
          .from("user_phone_accounts")
          .select("id, credentials")
          .eq("id", phoneAccountId)
          .maybeSingle();
        if (error || !acc) {
          return htmlResponse("Account not found", `<div class="h err">Phone account not found</div>`, 404);
        }

        const creds = (acc.credentials ?? {}) as Record<string, any>;
        const clientId = creds.client_id;
        const clientSecret = creds.client_secret;
        if (!clientId || !clientSecret) {
          return htmlResponse(
            "Missing credentials",
            `<div class="h err">Save your Client ID and Secret first</div>`,
            400
          );
        }

        const serverUrl = getServerUrl(creds.server_url);
        const redirectUri = getRedirectUri();

        const tokenRes = await fetch(`${serverUrl}/restapi/oauth/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          return htmlResponse(
            "Token exchange failed",
            `<div class="h err">RingCentral rejected the login</div><div class="p">${t.slice(0, 400)}</div>`,
            400
          );
        }

        const j = await tokenRes.json();
        const now = Date.now();
        const newCreds = {
          ...creds,
          access_token: j.access_token,
          refresh_token: j.refresh_token,
          token_expires_at: now + (Number(j.expires_in ?? 3600) - 30) * 1000,
          refresh_expires_at: now + (Number(j.refresh_token_expires_in ?? 604800) - 60) * 1000,
          owner_id: j.owner_id,
        };

        const { error: upErr } = await supabaseAdmin
          .from("user_phone_accounts")
          .update({ credentials: newCreds as any })
          .eq("id", phoneAccountId);

        if (upErr) {
          return htmlResponse(
            "Save failed",
            `<div class="h err">Could not save tokens</div><div class="p">${upErr.message}</div>`,
            500
          );
        }

        return htmlResponse(
          "Signed in",
          `<div class="h ok">✓ RingCentral connected</div><div class="p">You can close this window and start making calls from your browser.</div>`
        );
      },
    },
  },
});
