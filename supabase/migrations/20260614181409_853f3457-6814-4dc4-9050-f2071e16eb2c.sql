ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS unsubscribe_footer_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unsubscribe_footer_text text;

CREATE TABLE IF NOT EXISTS public.unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_email text NOT NULL,
  email_account text,
  campaign_name text,
  source text NOT NULL DEFAULT 'instantly',
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lead_email)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unsubscribes TO authenticated;
GRANT ALL ON public.unsubscribes TO service_role;

ALTER TABLE public.unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own unsubscribes" ON public.unsubscribes;
CREATE POLICY "Users manage own unsubscribes"
  ON public.unsubscribes
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS unsubscribes_user_idx
  ON public.unsubscribes(user_id);

CREATE INDEX IF NOT EXISTS unsubscribes_user_time_idx
  ON public.unsubscribes(user_id, unsubscribed_at DESC);