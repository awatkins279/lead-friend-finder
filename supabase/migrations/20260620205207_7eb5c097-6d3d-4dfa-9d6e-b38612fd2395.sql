SET statement_timeout = '30min';
CREATE INDEX IF NOT EXISTS leads_employee_count_idx ON public.leads (org_employee_count);
ANALYZE public.leads (org_employee_count);