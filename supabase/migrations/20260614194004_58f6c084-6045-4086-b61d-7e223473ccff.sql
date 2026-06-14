ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS instantly_campaign_id text;

CREATE UNIQUE INDEX IF NOT EXISTS lists_user_instantly_campaign_idx
  ON public.lists(user_id, instantly_campaign_id)
  WHERE instantly_campaign_id IS NOT NULL;