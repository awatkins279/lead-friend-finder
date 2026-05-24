
ALTER TABLE public.lists
ADD COLUMN IF NOT EXISTS voicemail_audio_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemail-drops', 'voicemail-drops', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "voicemail drops are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'voicemail-drops');

CREATE POLICY "users upload their own voicemail drops"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'voicemail-drops'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "users update their own voicemail drops"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'voicemail-drops'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "users delete their own voicemail drops"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'voicemail-drops'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
