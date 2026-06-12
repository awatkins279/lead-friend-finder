CREATE TABLE IF NOT EXISTS public.instantly_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  api_key text NOT NULL,
  workspace_name text,
  status text NOT NULL DEFAULT 'active',
  account_count integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.instantly_connections TO authenticated;
GRANT ALL ON public.instantly_connections TO service_role;

ALTER TABLE public.instantly_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own instantly connection" ON public.instantly_connections;
CREATE POLICY "Users manage own instantly connection"
  ON public.instantly_connections
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS instantly_connections_touch ON public.instantly_connections;
CREATE TRIGGER instantly_connections_touch
  BEFORE UPDATE ON public.instantly_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();