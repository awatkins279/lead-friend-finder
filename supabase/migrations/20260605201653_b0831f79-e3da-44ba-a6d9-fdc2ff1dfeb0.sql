
-- Add email verification columns to list_leads
ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_result text,
  ADD COLUMN IF NOT EXISTS verification_quality text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_list_leads_verification_status
  ON public.list_leads(list_id, verification_status);

-- Register verify_email credit cost (1 credit per email)
INSERT INTO public.credit_costs (action, cost_per_unit, description)
VALUES ('verify_email', 1, 'Email deliverability verification via MillionVerifier')
ON CONFLICT (action) DO UPDATE
  SET cost_per_unit = EXCLUDED.cost_per_unit,
      description = EXCLUDED.description,
      updated_at = now();
