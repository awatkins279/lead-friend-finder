import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Google Calendar OAuth — callback.
 * Exchanges the code for tokens, fetches the user's email, and stores the
 * connection. Then redirects back to /app/calendar.
 */
export const Route = createFileRoute("/api/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return new Response("Google Calendar not configured", { status: 503 });
        }

        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const userId = url.searchParams.get("state");
        if (!code || !userId) {
          return new Response("Missing code or state", { status: 400 });
        }

        const redirectUri = `${url.origin}/api/google-calendar/callback`;

        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        if (!tokenRes.ok) {
          const txt = await tokenRes.text();
          return new Response(`Token exchange failed: ${txt}`, { status: 502 });
        }
        const tokens = await tokenRes.json();

        // Get the user's Google email
        const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const info = infoRes.ok ? await infoRes.json() : { email: "" };

        const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

        const { error } = await supabaseAdmin.from("google_calendar_connections").upsert(
          {
            user_id: userId,
            google_email: info.email ?? "unknown",
            calendar_id: "primary",
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? "",
            token_expires_at: expiresAt,
            scopes: tokens.scope ?? null,
          },
          { onConflict: "user_id" },
        );
        if (error) {
          return new Response(`Failed to save connection: ${error.message}`, { status: 500 });
        }

        return new Response(null, {
          status: 302,
          headers: { Location: "/app/calendar?connected=1" },
        });
      },
    },
  },
});
