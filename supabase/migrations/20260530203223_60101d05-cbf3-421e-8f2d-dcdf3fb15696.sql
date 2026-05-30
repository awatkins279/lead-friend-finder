-- 1. Coaching styles (admin-curated sales-trainer styles)
CREATE TABLE public.coaching_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  system_prompt text NOT NULL,
  hard_rules text,
  example_objection_handlers jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coaching_styles TO authenticated;
GRANT ALL ON public.coaching_styles TO service_role;

ALTER TABLE public.coaching_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read coaching styles"
  ON public.coaching_styles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage coaching styles"
  ON public.coaching_styles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER coaching_styles_updated_at BEFORE UPDATE ON public.coaching_styles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ensure only one default style at a time
CREATE UNIQUE INDEX coaching_styles_only_one_default
  ON public.coaching_styles ((is_default)) WHERE is_default = true;

-- 2. Per-campaign knowledge docs (what the customer sells, battlecards, etc.)
CREATE TABLE public.coaching_knowledge_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  list_id uuid NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'pending',
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_knowledge_docs TO authenticated;
GRANT ALL ON public.coaching_knowledge_docs TO service_role;

ALTER TABLE public.coaching_knowledge_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own coaching knowledge docs"
  ON public.coaching_knowledge_docs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX coaching_knowledge_docs_list_idx ON public.coaching_knowledge_docs (list_id);
CREATE INDEX coaching_knowledge_docs_user_idx ON public.coaching_knowledge_docs (user_id);

CREATE TRIGGER coaching_knowledge_docs_updated_at BEFORE UPDATE ON public.coaching_knowledge_docs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Chunks for retrieval (uses pg_trgm — already installed)
CREATE TABLE public.coaching_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.coaching_knowledge_docs(id) ON DELETE CASCADE,
  list_id uuid NOT NULL,
  user_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.coaching_knowledge_chunks TO authenticated;
GRANT ALL ON public.coaching_knowledge_chunks TO service_role;

ALTER TABLE public.coaching_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own coaching knowledge chunks"
  ON public.coaching_knowledge_chunks FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own coaching knowledge chunks"
  ON public.coaching_knowledge_chunks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own coaching knowledge chunks"
  ON public.coaching_knowledge_chunks FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX coaching_knowledge_chunks_list_idx ON public.coaching_knowledge_chunks (list_id);
CREATE INDEX coaching_knowledge_chunks_doc_idx ON public.coaching_knowledge_chunks (doc_id);
CREATE INDEX coaching_knowledge_chunks_content_trgm ON public.coaching_knowledge_chunks
  USING GIN (content gin_trgm_ops);

-- 4. Live events stream during a call (transcript + suggestions)
CREATE TABLE public.call_live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL, -- 'transcript' | 'suggestion' | 'highlight' | 'note'
  role text,          -- 'rep' | 'prospect' | null
  text text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.call_live_events TO authenticated;
GRANT ALL ON public.call_live_events TO service_role;

ALTER TABLE public.call_live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own call live events"
  ON public.call_live_events FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX call_live_events_call_idx ON public.call_live_events (call_id, ts);

-- 5. Link campaigns to a chosen coaching style
ALTER TABLE public.lists ADD COLUMN coaching_style_id uuid REFERENCES public.coaching_styles(id) ON DELETE SET NULL;
ALTER TABLE public.lists ADD COLUMN ai_copilot_enabled boolean NOT NULL DEFAULT false;

-- 6. Storage buckets (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('coaching-knowledge', 'coaching-knowledge', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('coaching-styles', 'coaching-styles', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage policies: coaching-knowledge (per-user, folder = user_id)
CREATE POLICY "Users read own coaching knowledge files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-knowledge' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own coaching knowledge files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coaching-knowledge' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own coaching knowledge files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-knowledge' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies: coaching-styles (admin write, all-auth read)
CREATE POLICY "Authenticated read coaching style files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-styles');
CREATE POLICY "Admins manage coaching style files"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'coaching-styles' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'coaching-styles' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Seed a default NEPQ-style entry so v1 has something to point at
INSERT INTO public.coaching_styles (name, description, system_prompt, hard_rules, is_default, example_objection_handlers)
VALUES (
  'NEPQ (Jeremy Miner style)',
  'Neuro-Emotional Persuasion Questioning — low-pressure, question-led, problem-aware. Tonality down, prospect talks 70%.',
  'You are an elite real-time cold-call coach trained in NEPQ. Listen to the conversation and tell the rep exactly what to say next in 1-3 short sentences. Stay calm, curious, never pitchy. Mirror the prospect''s words. Ask questions that surface pain in their own words. Never list features. Get permission before transitioning. Get commitment in THEIR words at the close.',
  'Never read the script verbatim. Never use "synergy", "leverage", "circle back". Never raise tonality at the end of questions. Never pitch features before the prospect has named the problem. If the prospect goes silent, the rep stays silent.',
  true,
  '[
    {"objection":"Not interested","response":"Totally fair — most folks say that on a cold call. Out of curiosity, what would have to be different about this for it to be even slightly relevant?"},
    {"objection":"Send me info","response":"Happy to — what specifically should I send so it''s actually useful and not just another deck you''ll ignore?"}
  ]'::jsonb
);