
ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS sender_title text,
  ADD COLUMN IF NOT EXISTS sender_company text,
  ADD COLUMN IF NOT EXISTS what_selling text,
  ADD COLUMN IF NOT EXISTS key_selling_points text,
  ADD COLUMN IF NOT EXISTS num_emails integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS word_count integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS personalization_level text NOT NULL DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS cta_type text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS extra_instructions text;

ALTER TABLE public.list_leads
  ADD COLUMN IF NOT EXISTS emails jsonb;
