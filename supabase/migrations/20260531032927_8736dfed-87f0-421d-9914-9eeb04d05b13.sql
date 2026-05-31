
-- Meetings table: source of truth for scheduled calls/demos
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lead_id TEXT,
  title TEXT NOT NULL,
  prospect_name TEXT,
  prospect_company TEXT,
  prospect_email TEXT,
  prospect_phone TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  meet_link TEXT,
  google_event_id TEXT,
  calendar_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','phone_call','sdr_email','google_sync','ai_booked')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes TEXT,
  prospect_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meetings_user_starts ON public.meetings(user_id, starts_at);
CREATE INDEX idx_meetings_google_event ON public.meetings(google_event_id) WHERE google_event_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own meetings" ON public.meetings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own meetings" ON public.meetings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own meetings" ON public.meetings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own meetings" ON public.meetings FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER meetings_updated_at BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Google Calendar connections (per-user OAuth tokens)
CREATE TABLE public.google_calendar_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  google_email TEXT NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tokens are sensitive; only service_role can read. Users see connection status via a server fn.
GRANT ALL ON public.google_calendar_connections TO service_role;
GRANT SELECT (id, user_id, google_email, calendar_id, last_sync_at, created_at), DELETE ON public.google_calendar_connections TO authenticated;

ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gcal status" ON public.google_calendar_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users disconnect own gcal" ON public.google_calendar_connections FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER gcal_updated_at BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Working hours preferences (used by AI when pitching slots)
CREATE TABLE public.scheduling_preferences (
  user_id UUID NOT NULL PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  workday_start_minute INT NOT NULL DEFAULT 540, -- 9:00am
  workday_end_minute INT NOT NULL DEFAULT 1020,  -- 5:00pm
  meeting_duration_minutes INT NOT NULL DEFAULT 30,
  buffer_minutes INT NOT NULL DEFAULT 15,
  workdays INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5], -- Mon-Fri
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_preferences TO authenticated;
GRANT ALL ON public.scheduling_preferences TO service_role;

ALTER TABLE public.scheduling_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own scheduling prefs" ON public.scheduling_preferences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER scheduling_prefs_updated_at BEFORE UPDATE ON public.scheduling_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
