-- Add call scoring fields and AI scorecard table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calls' AND column_name='scorecard') THEN
    ALTER TABLE public.calls ADD COLUMN scorecard jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calls' AND column_name='call_score') THEN
    ALTER TABLE public.calls ADD COLUMN call_score integer CHECK (call_score >= 0 AND call_score <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='calls' AND column_name='transcript') THEN
    ALTER TABLE public.calls ADD COLUMN transcript text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.call_practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Practice Session',
  scenario text NOT NULL DEFAULT 'skeptical',
  product_context text,
  prospect_persona text,
  transcript jsonb DEFAULT '[]'::jsonb,
  score integer CHECK (score >= 0 AND score <= 100),
  scorecard jsonb,
  duration_sec integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_practice_sessions TO authenticated;
GRANT ALL ON public.call_practice_sessions TO service_role;

ALTER TABLE public.call_practice_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='call_practice_sessions' AND policyname='Users own practice sessions') THEN
    CREATE POLICY "Users own practice sessions" ON public.call_practice_sessions
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS call_practice_sessions_user_idx ON public.call_practice_sessions(user_id, created_at DESC);