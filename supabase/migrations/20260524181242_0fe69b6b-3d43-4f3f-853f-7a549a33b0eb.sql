
-- Conversations
CREATE TABLE public.sdr_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  email_account_id uuid REFERENCES public.email_accounts(id) ON DELETE SET NULL,
  list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL,
  lead_id text,
  lead_email text NOT NULL,
  lead_name text,
  company text,
  subject text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_direction text NOT NULL DEFAULT 'inbound',
  unread_count integer NOT NULL DEFAULT 0,
  intent text,
  intent_confidence integer,
  status text NOT NULL DEFAULT 'open',
  meeting_booked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sdr_conv_user_last ON public.sdr_conversations(user_id, last_message_at DESC);
CREATE INDEX idx_sdr_conv_user_status ON public.sdr_conversations(user_id, status);
CREATE INDEX idx_sdr_conv_user_intent ON public.sdr_conversations(user_id, intent);
CREATE INDEX idx_sdr_conv_user_list ON public.sdr_conversations(user_id, list_id);

ALTER TABLE public.sdr_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own conversations" ON public.sdr_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_sdr_conv_updated BEFORE UPDATE ON public.sdr_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Messages
CREATE TABLE public.sdr_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.sdr_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  direction text NOT NULL,
  from_email text NOT NULL,
  from_name text,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text,
  body_text text,
  body_html text,
  snippet text,
  message_id text,
  in_reply_to text,
  email_references text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  received_at timestamptz,
  ai_generated boolean NOT NULL DEFAULT false,
  agent_id uuid REFERENCES public.sdr_agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sdr_msg_conv_time ON public.sdr_messages(conversation_id, COALESCE(sent_at, received_at, created_at));
CREATE INDEX idx_sdr_msg_user ON public.sdr_messages(user_id);
CREATE INDEX idx_sdr_msg_msgid ON public.sdr_messages(message_id);

ALTER TABLE public.sdr_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own messages" ON public.sdr_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_sdr_msg_updated BEFORE UPDATE ON public.sdr_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Attachments
CREATE TABLE public.sdr_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.sdr_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  filename text NOT NULL,
  size_bytes bigint,
  mime_type text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sdr_message_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own attachments" ON public.sdr_message_attachments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sdr_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sdr_messages;
