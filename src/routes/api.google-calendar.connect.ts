import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Google Calendar OAuth — start flow.
 * Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET secrets to be set.
 * Reads the current user from the bearer token in the Authorization header,
 * but since this is a browser redirect (no header), we use a state param
 * built from the user's id + a nonce, encoded via the user's Supabase session
 * cookie. For simplicity v1 reads the access token from a `?t=` query param
 * the client passes when launching the flow.
 */
export const Route = createFileRoute("/api/google-calendar/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
          return new Response(
            "Google Calendar is not configured yet. Ask the app owner to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
            { status: 503 },
          );
        }

        const url = new URL(request.url);
        const token = url.searchParams.get("t");
        if (!token) {
          return new Response("Missing auth token", { status: 401 });
        }

        // Verify the user
        const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !userData.user) {
          return new Response("Invalid session", { status: 401 });
        }

        const redirectUri = `${url.origin}/api/google-calendar/callback`;
        const scope = [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.readonly",
          "openid",
          "email",
        ].join(" ");

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", scope);
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", userData.user.id);

        throw redirect({ href: authUrl.toString() } as any);
      },
    },
  },
});
