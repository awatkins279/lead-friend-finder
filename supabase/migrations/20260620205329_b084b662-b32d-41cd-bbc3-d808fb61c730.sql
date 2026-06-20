SET statement_timeout = '30min';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS leads_city_trgm ON public.leads USING gin (city gin_trgm_ops);
ANALYZE public.leads (city);