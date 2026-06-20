SET statement_timeout = '30min';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS leads_state_trgm ON public.leads USING gin (state gin_trgm_ops);
ANALYZE public.leads (state);