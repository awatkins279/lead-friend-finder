CREATE TABLE IF NOT EXISTS public.list_email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  email_account_id uuid NOT NULL REFERENCES public.email_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, email_account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.list_email_accounts TO authenticated;
GRANT ALL ON public.list_email_accounts TO service_role;

ALTER TABLE public.list_email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own list email accounts"
  ON public.list_email_accounts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS list_email_accounts_list_idx
  ON public.list_email_accounts(list_id);

CREATE INDEX IF NOT EXISTS list_email_accounts_account_idx
  ON public.list_email_accounts(email_account_id);