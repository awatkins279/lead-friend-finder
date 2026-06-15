CREATE TABLE public.operator_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New campaign plan' CHECK (char_length(title) BETWEEN 1 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_threads TO authenticated;
GRANT ALL ON public.operator_threads TO service_role;
ALTER TABLE public.operator_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own operator threads" ON public.operator_threads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX operator_threads_user_updated_idx ON public.operator_threads (user_id, updated_at DESC);
CREATE TRIGGER touch_operator_threads_updated_at BEFORE UPDATE ON public.operator_threads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.operator_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.operator_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ai_message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thread_id, ai_message_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_messages TO authenticated;
GRANT ALL ON public.operator_messages TO service_role;
ALTER TABLE public.operator_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own operator messages" ON public.operator_messages FOR ALL TO authenticated USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.operator_threads t WHERE t.id = thread_id AND t.user_id = auth.uid())) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.operator_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()));
CREATE INDEX operator_messages_thread_created_idx ON public.operator_messages (thread_id, created_at);

CREATE TABLE public.operator_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.operator_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  offer_brief TEXT NOT NULL CHECK (char_length(offer_brief) BETWEEN 3 AND 10000),
  strategy JSONB NOT NULL,
  guardrails JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'running', 'paused', 'completed', 'superseded')),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thread_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_blueprints TO authenticated;
GRANT ALL ON public.operator_blueprints TO service_role;
ALTER TABLE public.operator_blueprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own operator blueprints" ON public.operator_blueprints FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX operator_blueprints_user_status_idx ON public.operator_blueprints (user_id, status, updated_at DESC);
CREATE TRIGGER touch_operator_blueprints_updated_at BEFORE UPDATE ON public.operator_blueprints FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.operator_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.operator_threads(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES public.operator_blueprints(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused', 'approval_required', 'rejected')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_events TO authenticated;
GRANT ALL ON public.operator_events TO service_role;
ALTER TABLE public.operator_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own operator events" ON public.operator_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX operator_events_thread_created_idx ON public.operator_events (thread_id, created_at DESC);
CREATE INDEX operator_events_status_idx ON public.operator_events (user_id, status, created_at);
CREATE TRIGGER touch_operator_events_updated_at BEFORE UPDATE ON public.operator_events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.operator_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  brief_date DATE NOT NULL,
  summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, brief_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_briefs TO authenticated;
GRANT ALL ON public.operator_briefs TO service_role;
ALTER TABLE public.operator_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own operator briefs" ON public.operator_briefs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX operator_briefs_user_date_idx ON public.operator_briefs (user_id, brief_date DESC);
CREATE TRIGGER touch_operator_briefs_updated_at BEFORE UPDATE ON public.operator_briefs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();