
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.email_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  email_address TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  auth_method TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, email_address)
);

ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own email accounts" ON public.email_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own email accounts" ON public.email_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own email accounts" ON public.email_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own email accounts" ON public.email_accounts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_email_accounts_updated_at
BEFORE UPDATE ON public.email_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

ALTER TABLE public.sdr_agents
  ADD COLUMN email_account_id UUID REFERENCES public.email_accounts(id) ON DELETE SET NULL;

CREATE INDEX idx_sdr_agents_email_account ON public.sdr_agents(email_account_id);
