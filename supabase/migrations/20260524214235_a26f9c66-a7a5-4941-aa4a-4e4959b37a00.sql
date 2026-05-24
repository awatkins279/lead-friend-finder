
UPDATE storage.buckets SET public = false WHERE id = 'voicemail-drops';

DROP POLICY IF EXISTS "voicemail drops are publicly readable" ON storage.objects;

CREATE POLICY "users read their own voicemail drops"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'voicemail-drops'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
