import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types ----------
export type Meeting = {
  id: string;
  user_id: string;
  lead_id: string | null;
  title: string;
  prospect_name: string | null;
  prospect_company: string | null;
  prospect_email: string | null;
  prospect_phone: string | null;
  starts_at: string;
  ends_at: string;
  meet_link: string | null;
  google_event_id: string | null;
  source: "manual" | "phone_call" | "sdr_email" | "google_sync" | "ai_booked";
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  prospect_summary: any | null;
};

export type SchedulingPrefs = {
  user_id: string;
  timezone: string;
  workday_start_minute: number;
  workday_end_minute: number;
  meeting_duration_minutes: number;
  buffer_minutes: number;
  workdays: number[];
};

// ---------- List meetings in range ----------
export const listMeetings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ from: z.string(), to: z.string() }).parse(i))
  .handler(async ({ data, context }): Promise<{ meetings: Meeting[] }> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("meetings")
      .select("*")
      .gte("starts_at", data.from)
      .lte("starts_at", data.to)
      .order("starts_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { meetings: (rows ?? []) as Meeting[] };
  });

// ---------- Get a single meeting (with prospect intel) ----------
export const getMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ meeting: Meeting | null; lead: any | null }> => {
    const { supabase } = context;
    const { data: m, error } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) return { meeting: null, lead: null };

    let lead: any = null;
    if (m.lead_id) {
      const { data: l } = await supabase
        .from("leads")
        .select(
          "id,first_name,last_name,title,org_name,org_industry,org_website,linkedin_url,email,phone,city,state,country",
        )
        .eq("id", m.lead_id)
        .maybeSingle();
      lead = l;
    }
    return { meeting: m as Meeting, lead };
  });

// ---------- Create / update / cancel ----------
const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  lead_id: z.string().optional().nullable(),
  title: z.string().min(1).max(200),
  prospect_name: z.string().max(200).optional().nullable(),
  prospect_company: z.string().max(200).optional().nullable(),
  prospect_email: z.string().email().optional().nullable().or(z.literal("")),
  prospect_phone: z.string().max(50).optional().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  meet_link: z.string().url().optional().nullable().or(z.literal("")),
  source: z
    .enum(["manual", "phone_call", "sdr_email", "google_sync", "ai_booked"])
    .default("manual"),
  notes: z.string().max(5000).optional().nullable(),
});

export const upsertMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => upsertSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ meeting: Meeting }> => {
    const { supabase, userId } = context;
    const row = {
      ...data,
      user_id: userId,
      prospect_email: data.prospect_email || null,
      meet_link: data.meet_link || null,
    };
    const q = data.id
      ? supabase.from("meetings").update(row).eq("id", data.id).select("*").single()
      : supabase.from("meetings").insert(row).select("*").single();
    const { data: m, error } = await q;
    if (error) throw new Error(error.message);
    return { meeting: m as Meeting };
  });

export const cancelMeeting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Scheduling preferences ----------
export const getSchedulingPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ prefs: SchedulingPrefs }> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("scheduling_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return { prefs: data as SchedulingPrefs };
    // Defaults
    return {
      prefs: {
        user_id: userId,
        timezone: "America/New_York",
        workday_start_minute: 540,
        workday_end_minute: 1020,
        meeting_duration_minutes: 30,
        buffer_minutes: 15,
        workdays: [1, 2, 3, 4, 5],
      },
    };
  });

const prefsSchema = z.object({
  timezone: z.string().min(1).max(60),
  workday_start_minute: z.number().int().min(0).max(1440),
  workday_end_minute: z.number().int().min(0).max(1440),
  meeting_duration_minutes: z.number().int().min(10).max(240),
  buffer_minutes: z.number().int().min(0).max(120),
  workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export const saveSchedulingPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => prefsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("scheduling_preferences")
      .upsert({ user_id: userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Availability — used by AI to pitch real open slots ----------

export type AvailableSlot = { start: string; end: string; label: string };

/**
 * Compute next N available meeting slots given the user's working hours,
 * existing meetings, and buffer. Returns ISO strings in UTC + a human label
 * in the user's local timezone (e.g. "Tuesday 2:00 PM ET").
 */
export const getAvailableSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        days_ahead: z.number().int().min(1).max(14).default(7),
        max_slots: z.number().int().min(1).max(10).default(3),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ slots: AvailableSlot[]; timezone: string }> => {
    const { supabase, userId } = context;
    const { data: prefsRow } = await supabase
      .from("scheduling_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const prefs: SchedulingPrefs = (prefsRow as any) ?? {
      user_id: userId,
      timezone: "America/New_York",
      workday_start_minute: 540,
      workday_end_minute: 1020,
      meeting_duration_minutes: 30,
      buffer_minutes: 15,
      workdays: [1, 2, 3, 4, 5],
    };

    const now = new Date();
    const horizon = new Date(now.getTime() + data.days_ahead * 24 * 60 * 60 * 1000);

    const { data: existing } = await supabase
      .from("meetings")
      .select("starts_at,ends_at,status")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", horizon.toISOString())
      .neq("status", "cancelled");

    const busy = (existing ?? []).map((m: any) => ({
      start: new Date(m.starts_at).getTime(),
      end: new Date(m.ends_at).getTime(),
    }));

    const slotMs = prefs.meeting_duration_minutes * 60 * 1000;
    const bufferMs = prefs.buffer_minutes * 60 * 1000;
    const slots: AvailableSlot[] = [];

    // Helper: format a Date in the user's timezone
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timezone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Helper: get the day-of-week (0-6, Sun=0) and minute-of-day in the user's timezone
    const tzParts = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: prefs.timezone,
        weekday: "short",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(d);
      const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const min = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
      const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
      return { dow, minuteOfDay: hour * 60 + min };
    };

    // Walk forward in 30-min increments, starting at next quarter-hour after now+buffer
    let cursor = new Date(
      Math.ceil((now.getTime() + 15 * 60 * 1000) / (15 * 60 * 1000)) * (15 * 60 * 1000),
    );
    const step = 15 * 60 * 1000;
    let guard = 0;
    while (slots.length < data.max_slots && cursor < horizon && guard++ < 2000) {
      const { dow, minuteOfDay } = tzParts(cursor);
      const inWorkday = prefs.workdays.includes(dow);
      const inHours =
        minuteOfDay >= prefs.workday_start_minute &&
        minuteOfDay + prefs.meeting_duration_minutes <= prefs.workday_end_minute;

      if (inWorkday && inHours) {
        const start = cursor.getTime();
        const end = start + slotMs;
        const conflict = busy.some((b) => start < b.end + bufferMs && end + bufferMs > b.start);
        if (!conflict) {
          slots.push({
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            label: fmt.format(new Date(start)),
          });
          cursor = new Date(end + bufferMs);
          continue;
        }
      }
      cursor = new Date(cursor.getTime() + step);
    }

    return { slots, timezone: prefs.timezone };
  });

// ---------- Google Calendar connection status (no tokens exposed) ----------
export const getGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("google_calendar_connections")
      .select("id,google_email,calendar_id,last_sync_at,created_at")
      .maybeSingle();
    return { connected: !!data, connection: data ?? null };
  });

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("google_calendar_connections")
      .delete()
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
