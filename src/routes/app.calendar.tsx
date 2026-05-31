import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listMeetings,
  upsertMeeting,
  cancelMeeting,
  getMeeting,
  getSchedulingPrefs,
  saveSchedulingPrefs,
  getGoogleCalendarStatus,
  disconnectGoogleCalendar,
  type Meeting,
  type SchedulingPrefs,
} from "@/lib/meetings.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Video,
  Building2,
  User as UserIcon,
  Mail,
  Phone,
  Sparkles,
  Settings2,
  X,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/app/calendar")({
  component: CalendarPage,
});

const SOURCE_COLORS: Record<Meeting["source"], string> = {
  manual: "bg-sky-500/20 text-sky-200 border-sky-400/30",
  ai_booked: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30",
  phone_call: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  sdr_email: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  google_sync: "bg-slate-500/20 text-slate-200 border-slate-400/30",
};

function CalendarPage() {
  const fetchList = useServerFn(listMeetings);
  const fetchStatus = useServerFn(getGoogleCalendarStatus);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gcal, setGcal] = useState<{ connected: boolean; email?: string | null }>({ connected: false });

  const load = async () => {
    setLoading(true);
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59).toISOString();
    try {
      const r = await fetchList({ data: { from, to } });
      setMeetings(r.meetings);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    fetchStatus().then((r) =>
      setGcal({ connected: r.connected, email: r.connection?.google_email }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const x of meetings) {
      const d = new Date(x.starts_at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return m;
  }, [meetings]);

  const days = useMemo(() => buildMonthGrid(month), [month]);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const selectedKey = selectedDay ? dayKey(selectedDay) : "";
  const selectedMeetings = byDay.get(selectedKey) ?? [];

  return (
    <div className="glass-panel-strong rounded-2xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarIcon className="h-6 w-6" /> Calendar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every scheduled call & demo. AI uses your availability here to pitch real open slots in real time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              gcal.connected
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-muted-foreground"
            }`}
          >
            {gcal.connected ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Google Calendar · {gcal.email}
              </>
            ) : (
              <>Google Calendar not connected</>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <Settings2 className="mr-2 h-4 w-4" /> Settings
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="mr-2 h-4 w-4" /> New meeting
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Month grid */}
        <div className="glass-panel rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-lg font-medium">
              {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const d = new Date();
                  setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setSelectedDay(d);
                }}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              const inMonth = d.getMonth() === month.getMonth();
              const today = isSameDay(d, new Date());
              const sel = selectedDay && isSameDay(d, selectedDay);
              const items = byDay.get(dayKey(d)) ?? [];
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(d)}
                  className={`relative min-h-[78px] rounded-lg border p-1.5 text-left transition-all ${
                    sel
                      ? "border-[oklch(0.78_0.16_210)] bg-white/10"
                      : "border-white/5 hover:bg-white/5"
                  } ${inMonth ? "" : "opacity-40"}`}
                >
                  <div
                    className={`text-xs ${
                      today ? "inline-grid h-5 w-5 place-items-center rounded-full bg-[var(--gradient-aurora)] font-semibold text-white" : ""
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 2).map((m) => (
                      <div
                        key={m.id}
                        className={`truncate rounded border px-1 py-0.5 text-[10px] ${SOURCE_COLORS[m.source]}`}
                        title={m.title}
                      >
                        {formatTime(m.starts_at)} {m.prospect_name ?? m.title}
                      </div>
                    ))}
                    {items.length > 2 && (
                      <div className="text-[10px] text-muted-foreground">+{items.length - 2} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {loading && <div className="mt-3 text-xs text-muted-foreground">Loading…</div>}
        </div>

        {/* Day list */}
        <div className="glass-panel rounded-xl p-4">
          <div className="mb-3 text-sm font-medium">
            {selectedDay
              ? selectedDay.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "Pick a day"}
          </div>
          {selectedMeetings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
              No meetings on this day.
            </div>
          ) : (
            <div className="space-y-2">
              {selectedMeetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setOpenMeetingId(m.id)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left transition-all hover:border-white/20 hover:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{m.title}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[m.prospect_name, m.prospect_company].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${SOURCE_COLORS[m.source]}`}>
                      {m.source.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{formatTime(m.starts_at)} – {formatTime(m.ends_at)}</span>
                    {m.meet_link && (
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <Video className="h-3 w-3" /> Meet link
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New meeting dialog */}
      <NewMeetingDialog
        open={showNew}
        onOpenChange={setShowNew}
        defaultDate={selectedDay ?? new Date()}
        onSaved={() => {
          setShowNew(false);
          load();
        }}
      />

      {/* Meeting detail sheet */}
      <MeetingDetailSheet
        meetingId={openMeetingId}
        onClose={() => setOpenMeetingId(null)}
        onChanged={() => {
          load();
          setOpenMeetingId(null);
        }}
      />

      {/* Settings dialog */}
      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        gcalConnected={gcal.connected}
        gcalEmail={gcal.email ?? null}
        onGcalChanged={() =>
          fetchStatus().then((r) =>
            setGcal({ connected: r.connected, email: r.connection?.google_email }),
          )
        }
      />
    </div>
  );
}

// ---------- helpers ----------
function buildMonthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // Sun-start
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- New meeting dialog ----------
function NewMeetingDialog({
  open,
  onOpenChange,
  defaultDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDate: Date;
  onSaved: () => void;
}) {
  const save = useServerFn(upsertMeeting);
  const [busy, setBusy] = useState(false);
  const init = useMemo(() => {
    const d = new Date(defaultDate);
    d.setHours(10, 0, 0, 0);
    const e = new Date(d.getTime() + 30 * 60000);
    return {
      title: "Discovery call",
      prospect_name: "",
      prospect_company: "",
      prospect_email: "",
      prospect_phone: "",
      starts_at: toLocalInput(d),
      ends_at: toLocalInput(e),
      meet_link: "",
      notes: "",
    };
  }, [defaultDate, open]);
  const [form, setForm] = useState(init);
  useEffect(() => setForm(init), [init]);

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          title: form.title,
          prospect_name: form.prospect_name || null,
          prospect_company: form.prospect_company || null,
          prospect_email: form.prospect_email || null,
          prospect_phone: form.prospect_phone || null,
          starts_at: new Date(form.starts_at).toISOString(),
          ends_at: new Date(form.ends_at).toISOString(),
          meet_link: form.meet_link || null,
          source: "manual",
          notes: form.notes || null,
        },
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prospect name</Label>
              <Input value={form.prospect_name} onChange={(e) => setForm({ ...form, prospect_name: e.target.value })} />
            </div>
            <div>
              <Label>Company</Label>
              <Input value={form.prospect_company} onChange={(e) => setForm({ ...form, prospect_company: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.prospect_email} onChange={(e) => setForm({ ...form, prospect_email: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.prospect_phone} onChange={(e) => setForm({ ...form, prospect_phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Starts</Label>
              <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </div>
            <div>
              <Label>Ends</Label>
              <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Meet link (optional)</Label>
            <Input placeholder="https://meet.google.com/..." value={form.meet_link} onChange={(e) => setForm({ ...form, meet_link: e.target.value })} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create meeting"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Meeting detail sheet ----------
function MeetingDetailSheet({
  meetingId,
  onClose,
  onChanged,
}: {
  meetingId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fetchOne = useServerFn(getMeeting);
  const cancel = useServerFn(cancelMeeting);
  const [data, setData] = useState<{ meeting: Meeting | null; lead: any | null }>({ meeting: null, lead: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) return;
    setLoading(true);
    fetchOne({ data: { id: meetingId } })
      .then((r) => setData(r))
      .finally(() => setLoading(false));
  }, [meetingId, fetchOne]);

  const m = data.meeting;
  const lead = data.lead;

  return (
    <Sheet open={!!meetingId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Meeting details</SheetTitle>
        </SheetHeader>
        {loading || !m ? (
          <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">When</div>
              <div className="mt-1 text-sm">
                {new Date(m.starts_at).toLocaleString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                – {formatTime(m.ends_at)}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Title</div>
              <div className="mt-1 text-sm font-medium">{m.title}</div>
            </div>

            {(m.prospect_name || lead) && (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Prospect</div>
                <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
                  {(m.prospect_name || (lead && `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim())) && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {m.prospect_name || `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim()}
                      {lead?.title && <span className="text-muted-foreground">· {lead.title}</span>}
                    </div>
                  )}
                  {(m.prospect_company || lead?.org_name) && (
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {m.prospect_company || lead?.org_name}
                      {lead?.org_industry && <span className="text-muted-foreground">· {lead.org_industry}</span>}
                    </div>
                  )}
                  {(m.prospect_email || lead?.email) && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {m.prospect_email || lead?.email}
                    </div>
                  )}
                  {(m.prospect_phone || lead?.phone) && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {m.prospect_phone || lead?.phone}
                    </div>
                  )}
                </div>
              </div>
            )}

            {m.prospect_summary && (
              <div>
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> AI prospect summary
                </div>
                <div className="mt-1 whitespace-pre-wrap rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs">
                  {typeof m.prospect_summary === "string"
                    ? m.prospect_summary
                    : JSON.stringify(m.prospect_summary, null, 2)}
                </div>
              </div>
            )}

            {m.notes && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{m.notes}</div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {m.meet_link && (
                <a href={m.meet_link} target="_blank" rel="noreferrer">
                  <Button size="sm">
                    <Video className="mr-2 h-4 w-4" /> Join Meet
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </Button>
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await cancel({ data: { id: m.id } });
                  onChanged();
                }}
              >
                <X className="mr-2 h-4 w-4" /> Cancel meeting
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Settings dialog ----------
function SettingsDialog({
  open,
  onOpenChange,
  gcalConnected,
  gcalEmail,
  onGcalChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  gcalConnected: boolean;
  gcalEmail: string | null;
  onGcalChanged: () => void;
}) {
  const fetchPrefs = useServerFn(getSchedulingPrefs);
  const savePrefs = useServerFn(saveSchedulingPrefs);
  const disconnect = useServerFn(disconnectGoogleCalendar);
  const [prefs, setPrefs] = useState<SchedulingPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) fetchPrefs().then((r) => setPrefs(r.prefs));
  }, [open, fetchPrefs]);

  const submit = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await savePrefs({
        data: {
          timezone: prefs.timezone,
          workday_start_minute: prefs.workday_start_minute,
          workday_end_minute: prefs.workday_end_minute,
          meeting_duration_minutes: prefs.meeting_duration_minutes,
          buffer_minutes: prefs.buffer_minutes,
          workdays: prefs.workdays,
        },
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const toHHMM = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Calendar settings</DialogTitle>
        </DialogHeader>

        {/* Google Calendar */}
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2 text-sm font-medium">Google Calendar</div>
          {gcalConnected ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Connected as {gcalEmail}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await disconnect();
                  onGcalChanged();
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Connect your Google Calendar so meetings auto-create Google Meet links and sync both ways.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={async () => {
                  const { supabase } = await import("@/integrations/supabase/client");
                  const { data } = await supabase.auth.getSession();
                  const t = data.session?.access_token;
                  if (!t) return;
                  window.location.href = `/api/google-calendar/connect?t=${encodeURIComponent(t)}`;
                }}
              >
                <CalendarIcon className="mr-2 h-4 w-4" /> Connect Google Calendar
              </Button>
            </>
          )}
        </div>

        {/* Scheduling prefs */}
        {prefs && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Working hours (used by the AI when pitching slots)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Timezone</Label>
                <Input value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })} />
              </div>
              <div>
                <Label>Meeting length (min)</Label>
                <Input
                  type="number"
                  value={prefs.meeting_duration_minutes}
                  onChange={(e) =>
                    setPrefs({ ...prefs, meeting_duration_minutes: parseInt(e.target.value || "30", 10) })
                  }
                />
              </div>
              <div>
                <Label>Day starts</Label>
                <Input
                  type="time"
                  value={toHHMM(prefs.workday_start_minute)}
                  onChange={(e) => setPrefs({ ...prefs, workday_start_minute: toMinutes(e.target.value) })}
                />
              </div>
              <div>
                <Label>Day ends</Label>
                <Input
                  type="time"
                  value={toHHMM(prefs.workday_end_minute)}
                  onChange={(e) => setPrefs({ ...prefs, workday_end_minute: toMinutes(e.target.value) })}
                />
              </div>
              <div>
                <Label>Buffer between meetings (min)</Label>
                <Input
                  type="number"
                  value={prefs.buffer_minutes}
                  onChange={(e) => setPrefs({ ...prefs, buffer_minutes: parseInt(e.target.value || "0", 10) })}
                />
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Working days</Label>
              <div className="flex flex-wrap gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                  const on = prefs.workdays.includes(i);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        setPrefs({
                          ...prefs,
                          workdays: on
                            ? prefs.workdays.filter((x) => x !== i)
                            : [...prefs.workdays, i].sort(),
                        })
                      }
                      className={`rounded-md border px-3 py-1 text-xs ${
                        on
                          ? "border-[oklch(0.78_0.16_210)] bg-white/10"
                          : "border-white/10 text-muted-foreground hover:bg-white/5"
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={saving || !prefs} onClick={submit}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
