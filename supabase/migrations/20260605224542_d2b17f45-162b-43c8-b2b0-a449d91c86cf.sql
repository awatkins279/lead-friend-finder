
CREATE TABLE public.lead_verifications (
  user_id UUID NOT NULL,
  lead_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  quality TEXT,
  email TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lead_id)
);

CREATE INDEX lead_verifications_user_status_idx ON public.lead_verifications (user_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_verifications TO authenticated;
GRANT ALL ON public.lead_verifications TO service_role;

ALTER TABLE public.lead_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lead verifications"
  ON public.lead_verifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
