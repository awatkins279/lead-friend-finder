import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type RCCreds = {
  server_url?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number; // ms epoch
  refresh_expires_at?: number; // ms epoch
  owner_id?: string;
};

function getServerUrl(creds: RCCreds): string {
  const raw = (creds.server_url || "").trim();
  const url = /^https?:\/\//i.test(raw) ? raw : "https://platform.ringcentral.com";
  return url.replace(/\/$/, "");
}

function getRedirectUri(): string {
  // Use the published URL for the OAuth redirect. RingCentral requires this
  // to exactly match one of the redirect URIs registered on the app.
  const explicit = process.env.RINGCENTRAL_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.SITE_URL || "https://lead-friend-finder.lovable.app";
  return `${base.replace(/\/$/, "")}/api/ringcentral/oauth/callback`;
}

async function ensureFreshToken(creds: RCCreds): Promise<RCCreds> {
  const now = Date.now();
  if (creds.access_token && creds.token_expires_at && creds.token_expires_at - now > 60_000) {
    return creds;
  }
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    throw new Error("RingCentral not connected — sign in again from Sending Accounts.");
  }
  const serverUrl = getServerUrl(creds);
  const res = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${creds.client_id}:${creds.client_secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh_token,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${t.slice(0, 200)} — sign in again.`);
  }
  const j = await res.json();
  return {
    ...creds,
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? creds.refresh_token,
    token_expires_at: now + (Number(j.expires_in ?? 3600) - 30) * 1000,
    refresh_expires_at: now + (Number(j.refresh_token_expires_in ?? 604800) - 60) * 1000,
  };
}

// ---------------------------------------------------------------------------
// Build the authorize URL (called when the user clicks "Sign in with RingCentral")
// ---------------------------------------------------------------------------
const authInput = z.object({ phoneAccountId: z.string().uuid() });

export const getRingCentralAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => authInput.parse(i))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { supabase } = context;
    const { data: acc, error } = await supabase
      .from("user_phone_accounts")
      .select("provider, credentials")
      .eq("id", data.phoneAccountId)
      .maybeSingle();
    if (error || !acc) throw new Error("Phone account not found");
    if (acc.provider !== "ringcentral") throw new Error("Not a RingCentral account");

    const creds = (acc.credentials ?? {}) as RCCreds;
    if (!creds.client_id)
      throw new Error("Save your Client ID and Client Secret first, then sign in.");

    const serverUrl = getServerUrl(creds);
    const redirectUri = getRedirectUri();
    const state = `${data.phoneAccountId}.${crypto.randomUUID()}`;

    const url = new URL(`${serverUrl}/restapi/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", creds.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "login consent");

    return { url: url.toString() };
  });

// ---------------------------------------------------------------------------
// Returns SIP provisioning + access token for the browser web-phone.
// Auto-refreshes the access token if it's about to expire.
// ---------------------------------------------------------------------------
const sipInput = z.object({ phoneAccountId: z.string().uuid() });

export const getRingCentralWebPhoneCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => sipInput.parse(i))
  .handler(async ({ data, context }): Promise<{ sipInfo: any; accessToken: string }> => {
    const { supabase } = context;
    const { data: acc, error } = await supabase
      .from("user_phone_accounts")
      .select("provider, credentials")
      .eq("id", data.phoneAccountId)
      .maybeSingle();
    if (error || !acc) throw new Error("Phone account not found");
    if (acc.provider !== "ringcentral") throw new Error("Not a RingCentral account");

    let creds = (acc.credentials ?? {}) as RCCreds;
    if (!creds.refresh_token) {
      throw new Error(
        "RingCentral not connected — click 'Sign in with RingCentral' in Sending Accounts.",
      );
    }
    creds = await ensureFreshToken(creds);

    // Persist refreshed tokens
    await supabase
      .from("user_phone_accounts")
      .update({ credentials: creds as any })
      .eq("id", data.phoneAccountId);

    const serverUrl = getServerUrl(creds);
    const sipRes = await fetch(`${serverUrl}/restapi/v1.0/client-info/sip-provision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sipInfo: [{ transport: "WSS" }] }),
    });
    if (!sipRes.ok) {
      const t = await sipRes.text();
      throw new Error(`SIP provision failed (${sipRes.status}): ${t.slice(0, 200)}`);
    }
    const sipInfo = await sipRes.json();
    return { sipInfo, accessToken: creds.access_token! };
  });

// ---------------------------------------------------------------------------
// Create the `calls` row for a RingCentral browser call. The browser does
// the actual WebRTC dial — this just persists the record we hang notes off.
// ---------------------------------------------------------------------------
const startInput = z.object({
  listId: z.string().uuid(),
  leadId: z.string().min(1),
  phoneAccountId: z.string().uuid(),
  toNumber: z.string().min(3).max(32),
});

export const startRingCentralBrowserCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => startInput.parse(i))
  .handler(async ({ data, context }): Promise<{ callId: string }> => {
    const { supabase, userId } = context;

    const { data: acc } = await supabase
      .from("user_phone_accounts")
      .select("from_number")
      .eq("id", data.phoneAccountId)
      .maybeSingle();
    if (!acc) throw new Error("Phone account not found");

    const { data: row, error } = await supabase
      .from("calls")
      .insert({
        user_id: userId,
        list_id: data.listId,
        lead_id: data.leadId,
        phone_account_id: data.phoneAccountId,
        to_number: data.toNumber,
        from_number: acc.from_number,
        status: "initiated",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { callId: row.id };
  });
