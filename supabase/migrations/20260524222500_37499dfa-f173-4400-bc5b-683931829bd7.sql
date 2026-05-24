
-- Profile additions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id text,
  ADD COLUMN IF NOT EXISTS voicemail_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow users to insert their own profile row (in case trigger didn't create one)
DO $$ BEGIN
  CREATE POLICY "Users insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Voicemail logs
CREATE TABLE IF NOT EXISTS public.voicemail_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  list_id uuid NOT NULL,
  lead_id text NOT NULL,
  call_id uuid,
  script text NOT NULL,
  voice_id text,
  audio_seconds numeric,
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.voicemail_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own voicemail logs" ON public.voicemail_logs
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS voicemail_logs_lead_idx
  ON public.voicemail_logs (user_id, lead_id, created_at DESC);

-- Storage bucket for voice clone source audio
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-clone-samples', 'voice-clone-samples', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Users read own voice clone samples" ON storage.objects
    FOR SELECT USING (bucket_id = 'voice-clone-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users upload own voice clone samples" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'voice-clone-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own voice clone samples" ON storage.objects
    FOR UPDATE USING (bucket_id = 'voice-clone-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own voice clone samples" ON storage.objects
    FOR DELETE USING (bucket_id = 'voice-clone-samples' AND auth.uid()::text = (storage.foldername(name))[1]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
