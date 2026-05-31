ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS product_description text,
  ADD COLUMN IF NOT EXISTS product_value_props text,
  ADD COLUMN IF NOT EXISTS ideal_customer text,
  ADD COLUMN IF NOT EXISTS common_objections text,
  ADD COLUMN IF NOT EXISTS proof_points text,
  ADD COLUMN IF NOT EXISTS pricing_notes text,
  ADD COLUMN IF NOT EXISTS competitors text,
  ADD COLUMN IF NOT EXISTS call_to_action text;